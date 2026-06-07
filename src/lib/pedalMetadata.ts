/**
 * Pre-fill pedal brand / name / dimensions from a picked search result.
 *
 * See proposals/pedal-metadata-extraction.md for the full design and the
 * trust-cost principle that drives the "only pre-fill dimensions from
 * high-confidence structured sources" rule. Short version:
 *
 *   - Wrong dimensions silently mis-scale the canvas. Blank > wrong.
 *   - Wrong brand/name is obvious in the typed field. Pre-fill aggressively.
 *
 * Sources, in priority order (earlier wins):
 *   1. JSON-LD `Product` schema (brand, name, width/depth/height with units)
 *   2. Labeled spec scrape — `Width: 2.87"`, `<th>Width</th><td>2.87 in</td>`,
 *      Strymon prose `6.75" wide`, Sweetwater embedded JSON. Strict: label
 *      must be exact, unit must be explicit, value must be in pedal range.
 *   3. OpenGraph + product meta tags (brand/name only)
 *   4. Page `<title>` matched against a known-brands list (brand/name only)
 *
 * Transport mirrors braveSearch.ts: under Tauri we route through
 * `@tauri-apps/plugin-http` to bypass CORS; in plain browser dev we use
 * the platform fetch (which will mostly CORS-fail — that's surfaced as
 * `page_unreachable`).
 */

import { searchPedalWeb, type BraveWebResult } from './braveSearch';
import { findPedalInCatalog } from '../data/pedalCatalog';

let cachedTauriFetch: typeof fetch | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function platformFetch(): Promise<typeof fetch> {
  if (!isTauri()) return fetch.bind(globalThis);
  if (cachedTauriFetch) return cachedTauriFetch;
  const mod = await import('@tauri-apps/plugin-http');
  cachedTauriFetch = mod.fetch;
  return cachedTauriFetch;
}

export interface ExtractedPedalMetadata {
  brand: string | null;
  name: string | null;
  /**
   * Always derived from a labeled, unit-tagged value (JSON-LD `Product`
   * schema OR a `Width`/`wide` label in the page text adjacent to a
   * number-plus-explicit-unit). Bare numbers and label-less `WxDxH`
   * forms are deliberately rejected — see proposal trust-cost section.
   */
  widthIn: number | null;
  /** Same source rules as widthIn — labeled + explicit unit only. */
  depthIn: number | null;
}

export type MetadataOutcome =
  | { kind: 'ok'; metadata: ExtractedPedalMetadata }
  /** Network failure, CORS, 4xx/5xx — the page never reached us. */
  | { kind: 'page_unreachable' }
  /** Page loaded but had zero usable signals (truly empty — rare). */
  | { kind: 'empty' };

export interface ExtractPedalMetadataOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Known pedal brands. Used only by the lowest-confidence title heuristic to
 * decide whether to split a `<title>` into brand + model. If none match, we
 * leave brand/name null rather than guess at random.
 *
 * Order matters: longer multi-word names come first so "Chase Bliss Audio"
 * matches before "Chase". Match is case-insensitive against the title.
 */
const KNOWN_BRANDS: readonly string[] = [
  'Chase Bliss Audio',
  'Chase Bliss',
  'Source Audio',
  'TC Electronic',
  'Way Huge',
  'Earthquaker Devices',
  'Earthquaker',
  'Line 6',
  'Boss',
  'MXR',
  'EHX',
  'Electro-Harmonix',
  'Strymon',
  'Walrus Audio',
  'Walrus',
  'JHS',
  'Wampler',
  'Empress',
  'Eventide',
  'Keeley',
  'Mooer',
  'ZVEX',
  'Z.Vex',
  'Catalinbread',
  'Maxon',
];

export async function extractPedalMetadata(
  pageUrl: string,
  options: ExtractPedalMetadataOptions = {},
): Promise<MetadataOutcome> {
  const fetchImpl = options.fetchImpl ?? (await platformFetch());

  let html: string;
  try {
    const response = await fetchImpl(pageUrl, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) return { kind: 'page_unreachable' };
    html = await response.text();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { kind: 'page_unreachable' };
  }

  if (html.length === 0) return { kind: 'page_unreachable' };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { kind: 'page_unreachable' };
  }

  const merged: ExtractedPedalMetadata = {
    brand: null,
    name: null,
    widthIn: null,
    depthIn: null,
  };

  // Highest confidence: JSON-LD Product schema.
  const fromJsonLd = extractFromJsonLd(doc);
  mergeMetadata(merged, fromJsonLd);

  // High: labeled spec values in the page text. JSON-LD with dimensions
  // is rare even on big retailers (Reverb/Sweetwater typically expose
  // name+brand but not dimensions in JSON-LD); this layer scrapes the
  // common alternatives — `<th>Width</th><td>2.87"</td>`, `Width: 73 mm`,
  // Strymon-style prose `6.75" wide x 5.1" deep`, and Sweetwater-style
  // embedded JSON `"Width":{...,"detail":"2.97\""...}`. Strict by design:
  // label must be exact, value must carry an explicit unit, result must
  // fall in the pedal sanity range.
  const fromLabels = extractFromTextLabels(doc);
  mergeMetadata(merged, fromLabels);

  // Medium: OpenGraph + product meta tags (brand/name only).
  const fromMeta = extractFromMeta(doc);
  mergeMetadata(merged, fromMeta);

  // Low: page <title> heuristic against known brands. Also folds in
  // `og:title` / `twitter:title`. The no-brand fallback (using the
  // title as a name when no known brand is found) only fires when a
  // higher-confidence layer already produced a brand — that anchors
  // the page as a real product listing rather than an article that
  // happens to have a clean-looking title.
  const fromTitle = extractFromTitle(doc, merged.brand !== null);
  mergeMetadata(merged, fromTitle);

  // Solo-dimension extractions are wrong far more often than right —
  // every bogus width reported in issue #73 (round 2: widthIn=16/18/20)
  // was a partial result where the page had no companion depth value
  // and our scraper picked up an unrelated number near the word "width"
  // (a shipping box, an image-asset dim, a JSON-LD bare number). The
  // "blank > wrong" rule the file's docstring leads with is decisive:
  // a paired (width, depth) on the same page is dramatically more
  // trustworthy than either alone, so we only surface dimensions when
  // both are present.
  if (merged.widthIn === null || merged.depthIn === null) {
    merged.widthIn = null;
    merged.depthIn = null;
  }

  // Last-resort: when the scrape gave us brand + name but no dims,
  // consult the curated catalog. Catalog entries are complete pairs
  // sourced from manufacturer specs / standard enclosures, so this
  // preserves the "complete pair or nothing" invariant. Catalog NEVER
  // overrides extracted dims — it only fills when both are still null.
  if (merged.widthIn === null && merged.depthIn === null) {
    const catalogHit = findPedalInCatalog(merged.brand, merged.name);
    if (catalogHit) {
      merged.widthIn = catalogHit.widthIn;
      merged.depthIn = catalogHit.depthIn;
    }
  }

  // Final pass: strip trademark cruft, redundant brand prefix, and
  // descriptor tails so the model name reads as just the model.
  merged.name = cleanPedalName(merged.name, merged.brand);

  const hasAnySignal =
    merged.brand !== null ||
    merged.name !== null ||
    merged.widthIn !== null ||
    merged.depthIn !== null;

  if (!hasAnySignal) return { kind: 'empty' };
  return { kind: 'ok', metadata: merged };
}

/** Earlier source wins — only fill fields that are still null on `into`. */
function mergeMetadata(
  into: ExtractedPedalMetadata,
  from: Partial<ExtractedPedalMetadata>,
): void {
  if (into.brand === null && from.brand != null) into.brand = from.brand;
  if (into.name === null && from.name != null) into.name = from.name;
  if (into.widthIn === null && from.widthIn != null) {
    into.widthIn = from.widthIn;
  }
  if (into.depthIn === null && from.depthIn != null) {
    into.depthIn = from.depthIn;
  }
}

// ---------- JSON-LD ----------

interface JsonLdNode {
  '@type'?: unknown;
  brand?: unknown;
  name?: unknown;
  width?: unknown;
  depth?: unknown;
  height?: unknown;
  '@graph'?: unknown;
}

function extractFromJsonLd(doc: Document): Partial<ExtractedPedalMetadata> {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(scripts)) {
    const raw = script.textContent;
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const node of flattenJsonLd(parsed)) {
      if (!isProductNode(node)) continue;
      const result = readProductNode(node);
      if (
        result.brand !== null ||
        result.name !== null ||
        result.widthIn !== null ||
        result.depthIn !== null
      ) {
        return result;
      }
    }
  }
  return {};
}

function flattenJsonLd(value: unknown): JsonLdNode[] {
  const out: JsonLdNode[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (v && typeof v === 'object') {
      const node = v as JsonLdNode;
      out.push(node);
      if (node['@graph'] !== undefined) visit(node['@graph']);
    }
  };
  visit(value);
  return out;
}

function isProductNode(node: JsonLdNode): boolean {
  const t = node['@type'];
  if (typeof t === 'string') return t.toLowerCase() === 'product';
  if (Array.isArray(t)) {
    return t.some(
      (x) => typeof x === 'string' && x.toLowerCase() === 'product',
    );
  }
  return false;
}

function readProductNode(node: JsonLdNode): ExtractedPedalMetadata {
  return {
    brand: readBrand(node.brand),
    name: typeof node.name === 'string' ? cleanString(node.name) : null,
    widthIn: parseDimension(node.width),
    // Pedal "depth" (front-to-back, the dimension that determines how much
    // room a pedal takes on a board front-to-back) is what JSON-LD usually
    // labels `depth`. Some schemas use `height` for the same axis on a
    // stompbox; fall back when depth is missing.
    depthIn: parseDimension(node.depth) ?? parseDimension(node.height),
  };
}

function readBrand(value: unknown): string | null {
  if (typeof value === 'string') return cleanString(value);
  if (value && typeof value === 'object') {
    const obj = value as { name?: unknown };
    if (typeof obj.name === 'string') return cleanString(obj.name);
  }
  return null;
}

// ---------- Labeled spec scrape ----------

/**
 * Pull `width`/`depth` dimensions out of the page text by looking for
 * an exact dimension label adjacent to a number with an explicit unit.
 * Two shapes are supported:
 *
 *   A. Label-before-value: `Width: 2.87 in`, `Width 2.87"`, and the
 *      flattened textContent of `<th>Width</th><td>2.87 in</td>` and
 *      `<dt>Depth</dt><dd>73 mm</dd>`. Also catches Sweetwater-style
 *      embedded JSON like `"Width":{...,"detail":"2.97\""...}` because
 *      the duplicated label key (the `"name":"Width"` field) sits close
 *      enough to the value to fit inside the gap window.
 *
 *   B. Value-then-adjective: `2.87" wide`, `5.12 in deep` — the Strymon
 *      prose convention `6.75" wide (17.15 cm) x 5.1" deep (12.95 cm)`.
 *
 * Deliberately ignores `height`/`tall`/`high` — for a stompbox those
 * describe off-board knob clearance, not the canvas footprint. Also
 * ignores `length`/`long` because the axis they refer to varies by
 * manufacturer convention; better to leave depth blank than guess.
 */
function extractFromTextLabels(doc: Document): Partial<ExtractedPedalMetadata> {
  const text = collectPageText(doc);

  let widthIn: number | null = null;
  let depthIn: number | null = null;

  const assign = (label: 'width' | 'depth', value: number | null): void => {
    if (value === null) return;
    if (label === 'width' && widthIn === null) widthIn = value;
    if (label === 'depth' && depthIn === null) depthIn = value;
  };

  // Pattern A: label, then up to 60 chars of intervening punctuation /
  // JSON noise, then the number + explicit unit. 60 covers Sweetwater's
  // embedded JSON layout; tighter would lose that case.
  const labelFirst =
    /\b(width|depth)\b.{0,60}?(\d+(?:\.\d+)?)\s*(inches|inch|in|"|″|”|mm|cm)(?![a-zA-Z])/gi;
  for (const m of text.matchAll(labelFirst)) {
    const label = (m[1] ?? '').toLowerCase() as 'width' | 'depth';
    const unit = m[3] ?? '';
    const matchEnd = (m.index ?? 0) + m[0].length;
    // Contextual rejection for the two ambiguous units. Doing this in
    // code rather than regex because the labelFirst pattern runs with
    // the `i` flag (label can be Width/WIDTH/etc.), which would also
    // case-fold any `[A-Z]` we tried to use as the sentence-boundary
    // check on the `in` unit. The page text includes <script> content
    // because Sweetwater puts spec data inside JSON blobs there, so
    // both classes of noise are common:
    //
    //   * `"width":"854"` (JSON image dimensions on Amazon, etc.) was
    //     matching 854 with the closing JSON string quote as the inch
    //     glyph (issue #73).
    //   * `16 in stock` / `16 in 2024` / `16 in 1 enclosure` were
    //     matching 16 with `in` as the unit (issue #73).
    if (unit === '"' && isJsonStringClose(text, matchEnd)) continue;
    if (unit.toLowerCase() === 'in' && !isInchUnitTerminating(text, matchEnd)) {
      continue;
    }
    const value = parseDimension(`${m[2]} ${unit}`);
    assign(label, value);
  }

  // Pattern B: number + unit + adjective directly after. Tight binding —
  // no intervening text — because the adjective IS the label.
  const adjectiveAfter =
    /(\d+(?:\.\d+)?)\s*(inches|inch|in|"|″|”|mm|cm)\s+(wide|deep)\b/gi;
  for (const m of text.matchAll(adjectiveAfter)) {
    const adj = (m[3] ?? '').toLowerCase();
    const value = parseDimension(`${m[1]} ${m[2]}`);
    assign(adj === 'wide' ? 'width' : 'depth', value);
  }

  return {
    ...(widthIn !== null ? { widthIn } : {}),
    ...(depthIn !== null ? { depthIn } : {}),
  };
}

/**
 * True iff the `"` at `pos` (the char right after our matched value+unit)
 * is the closing quote of a JSON string value — i.e. immediately followed
 * by a JSON value terminator. Used to reject `"width":"854"` shaped noise.
 *
 * Sweetwater's `"detail":"2.97\""` (escaped inch glyph inside a JSON
 * string) passes through here because after the inch glyph is the
 * *string's* closing `"` and only then a `,` — so the char at `pos` is
 * another `"`, not a terminator.
 */
function isJsonStringClose(text: string, pos: number): boolean {
  const next = text[pos];
  return next === ',' || next === ']' || next === '}';
}

/**
 * True iff the `in` we just matched genuinely terminates a clause —
 * end-of-text, common punctuation, dimension separator (`x`/`×`), OR
 * whitespace then a capital letter (the start of a new sentence or a
 * new dimension label like `Depth`). Rejects continuations like
 * "in stock", "in 2024", "in 1 enclosure".
 */
function isInchUnitTerminating(text: string, pos: number): boolean {
  if (pos >= text.length) return true;
  const next = text[pos];
  if (next === undefined) return true;
  if ('.,;:)]}/×'.includes(next)) return true;
  if (!/\s/.test(next)) return false;
  // Skip whitespace and look at the next non-whitespace char.
  let i = pos;
  while (i < text.length && /\s/.test(text[i] ?? '')) i++;
  const after = text[i];
  if (after === undefined) return true;
  if (after === 'x' || after === '×') {
    // Allow only when it's a standalone dimension separator (followed
    // by whitespace or end), not the start of a word like "extras".
    const following = text[i + 1];
    return following === undefined || /\s/.test(following);
  }
  return after >= 'A' && after <= 'Z';
}

/**
 * Flatten the document to a single line of text suitable for label-and-value
 * regex scanning. Notes:
 *
 * - We walk text nodes and join with spaces rather than using
 *   `Node.textContent` because the latter doesn't insert any separator
 *   between sibling elements — `<th>Width</th><td>2.87 in</td>` flattens
 *   to `Width2.87 in`, and the label loses its word boundary.
 * - We include `<script>` content because Sweetwater (and other Next/Nuxt
 *   sites) ship structured product data as JSON inside script tags rather
 *   than in the rendered DOM. CSS / JS code is naturally filtered by the
 *   unit allowlist — `px`/`em`/`rem` don't appear in our regex.
 * - We DO strip `<style>` so CSS rules like `min-width: 320px` don't
 *   pollute the text. CSS contains `width` constantly; even though `px`
 *   isn't a recognized unit, the noise hurts the lazy-match gap budget.
 * - JSON-escaped quotes (`2.97\"`) get un-escaped so the regex sees a
 *   real `"` as the inch unit.
 */
function collectPageText(doc: Document): string {
  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll('style, noscript').forEach((el) => el.remove());
  const root = clone.body ?? clone.documentElement;
  if (!root) return '';

  const parts: string[] = [];
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        // TEXT_NODE
        const t = child.textContent;
        if (t) parts.push(t);
      } else if (child.nodeType === 1) {
        // ELEMENT_NODE
        visit(child);
      }
    }
  };
  visit(root);

  return parts.join(' ').replace(/\\"/g, '"').replace(/\s+/g, ' ');
}

// ---------- OpenGraph / meta ----------

/**
 * Brand-only. Historically we also accepted `og:site_name` and used
 * `og:title` as the model name, but in practice both produced systematic
 * garbage (issue #73): on Walrus Audio pages `og:site_name` is "Walrus
 * Audio" which is fine, but on ModularGrid it's "ModularGrid"; on the
 * Strymon TimeLine FAQ page `og:title` is the article title "What are
 * the TimeLine pedal dimensions? - Strymon", which we'd then ship as
 * the model name.
 *
 * `og:title` is now folded into `extractFromTitleCandidates` below so
 * it has to pass the known-brand split test before contributing a name.
 */
function extractFromMeta(doc: Document): Partial<ExtractedPedalMetadata> {
  const get = (selector: string): string | null => {
    const el = doc.querySelector(selector);
    if (!el) return null;
    const content = el.getAttribute('content');
    return content ? cleanString(content) : null;
  };

  const brand =
    get('meta[property="product:brand"]') ??
    get('meta[name="product:brand"]') ??
    get('meta[property="og:brand"]');

  return brand !== null ? { brand } : {};
}

// ---------- Title heuristic ----------

/**
 * Try a few title-shaped candidates in priority order and return the
 * first one that contains a known brand. og:title and twitter:title are
 * walked first because they're usually a cleaner version of the page
 * title (no trailing site name, no `« Page 2 of 3` cruft); the actual
 * `<title>` element is the fallback.
 *
 * Title candidates that don't contain a known brand contribute nothing
 * — we used to ship raw `og:title` as a model name, which produced
 * article titles like "What are the TimeLine pedal dimensions?" as
 * model names on FAQ pages (issue #73).
 */
function extractFromTitle(
  doc: Document,
  allowNoBrandFallback: boolean,
): Partial<ExtractedPedalMetadata> {
  const candidates: string[] = [];
  const push = (s: string | null | undefined): void => {
    const v = s ? cleanString(s) : null;
    if (v) candidates.push(v);
  };
  push(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'));
  push(
    doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content'),
  );
  push(doc.querySelector('title')?.textContent);

  for (const title of candidates) {
    const split = splitByKnownBrand(title);
    if (split) return split;
  }

  if (!allowNoBrandFallback) return {};

  // No candidate carried a known brand, but a higher-confidence layer
  // already produced one (so the page is anchored as a real product
  // listing). Use the first candidate as a model-name fallback — many
  // boutique pedals' og:title is just a clean "Slö Multi Texture
  // Reverb" with no brand text in the title.
  for (const title of candidates) {
    const cleaned = trimTitleTail(title);
    if (cleaned.length > 0 && !looksLikeArticleProse(cleaned)) {
      return { name: cleaned };
    }
  }
  return {};
}

/**
 * Locate a known brand inside the title and pull a candidate model name
 * out of whichever side has more text. Handles both `Brand Model | Site`
 * (model is after) and `Model — Brand` (model is before).
 *
 * Returns null when no brand matches OR when the candidate model side
 * looks like article prose (question marks, "review", "best", "what",
 * etc.) — in that case the title isn't carrying product data, just SEO
 * for an article that mentions the pedal.
 */
function splitByKnownBrand(
  title: string,
): Partial<ExtractedPedalMetadata> | null {
  const lower = title.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    const idx = lower.indexOf(brand.toLowerCase());
    if (idx < 0) continue;
    const before = title.slice(0, idx).trim();
    const after = title.slice(idx + brand.length).trim();
    // Model is usually the longer side. For `Brand Model | Site`, after
    // wins; for `Model – Brand`, before wins.
    const candidate = after.length >= before.length ? after : before;
    const model = trimTitleTail(candidate);
    if (model.length === 0 || looksLikeArticleProse(model)) {
      return { brand };
    }
    return { brand, name: model };
  }
  return null;
}

// Cheap article-prose detector. We reject titles like
//   "What are the TimeLine pedal dimensions?"
//   "Best overdrive pedals of 2024"
//   "Boss DS-1 review"
// where the brand match is incidental — the page is a blog post, not a
// product listing, and the "model name" half is actually a sentence.
const ARTICLE_WORDS = new Set([
  'what',
  'how',
  'why',
  'when',
  'where',
  'who',
  'best',
  'top',
  'review',
  'reviews',
  'reviewed',
  'vs',
  'versus',
  'compared',
  'comparing',
  'dimensions',
  'specs',
  'specifications',
  'guide',
]);

function looksLikeArticleProse(s: string): boolean {
  if (s.length > 60) return true;
  if (s.includes('?')) return true;
  const first =
    s
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? '';
  if (ARTICLE_WORDS.has(first)) return true;
  const tokens = s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  return tokens.some((t) => ARTICLE_WORDS.has(t));
}

// Padded dashes / pipes / bullets split the title tail; bare hyphens don't
// (otherwise "DS-1" becomes "DS"). Colon is fine without padding.
const TITLE_SEPARATORS = /\s+[|\-–—·]\s+|:/;

function trimTitleTail(s: string): string {
  // Cut at the first separator (Reverb / Sweetwater pages do "Boss DS-1 | Reverb").
  const split = s.split(TITLE_SEPARATORS)[0]?.trim() ?? '';
  // Drop common descriptors so "DS-1 Distortion Pedal" -> "DS-1".
  return (
    split
      .replace(
        /\b(distortion|overdrive|fuzz|delay|reverb|chorus|tremolo|phaser|compressor|boost|eq|wah|looper|tuner|octave|pitch|modulation)\s+pedal\b/i,
        '',
      )
      .replace(/\bpedal\b/i, '')
      .replace(/\s{2,}/g, ' ')
      // Strip leading punctuation left over after splitting "Boss - DS-1" →
      // " DS-1" which would otherwise read "- DS-1".
      .replace(/^[-–—·:|\s]+/, '')
      .replace(/[-–—·:|\s]+$/, '')
      .trim()
  );
}

// ---------- Name cleaning ----------

/**
 * Post-process an extracted model name so it reads as just the model.
 * Targets the systematic ugliness seen in real og:title / JSON-LD names:
 *
 *   "® PHASE 90"                              -> "PHASE 90"
 *   "Wampler Tumnus Overdrive Pedal" (Wampler) -> "Tumnus"
 *   "H9 Max Harmonizer® Multi FX"             -> "H9 Max"
 *   "Effects Inc."                            -> null (entirely cruft)
 *   "Morning Glory Pedal" (JHS Pedals)        -> "Morning Glory"
 *
 * Strips, in order: trademark/copyright marks, leading/trailing
 * punctuation, leading redundant brand prefix, trailing corporate
 * suffixes ("Inc.", "LLC", "Co."), redundant trailing "Pedal"/"Pedals",
 * and the same descriptor pass `trimTitleTail` uses.
 */
function cleanPedalName(
  name: string | null,
  brand: string | null,
): string | null {
  if (name === null) return null;
  let s = name;

  // 1. Trademark / copyright marks anywhere.
  s = s.replace(/[®™©℠]/g, ' ');

  // 2. Collapse whitespace and strip leading/trailing punctuation.
  const trimEdges = (x: string): string =>
    x
      .replace(/\s+/g, ' ')
      .replace(/^[-–—·:|\s]+/, '')
      .replace(/[-–—·:|\s]+$/, '')
      .trim();
  s = trimEdges(s);

  // 3. Strip leading brand prefix, token-by-token, when the name starts
  //    with the brand.
  if (brand !== null && brand.trim().length > 0) {
    const brandTokens = brand.trim().toLowerCase().split(/\s+/);
    const nameTokens = s.split(/\s+/);
    let i = 0;
    while (
      i < brandTokens.length &&
      i < nameTokens.length &&
      (nameTokens[i] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') ===
        (brandTokens[i] ?? '').replace(/[^a-z0-9]/g, '')
    ) {
      i++;
    }
    if (i > 0) {
      s = nameTokens.slice(i).join(' ');
      s = trimEdges(s);
    }
  }

  // 4. Trailing corporate suffixes.
  s = s.replace(/\s+(?:Inc\.?|LLC\.?|Co\.?|Ltd\.?|Corp\.?)\s*$/i, '').trim();

  // 5. Redundant trailing "Pedal" / "Pedals" — always strip, since the
  //    extracted name is by definition for a pedal.
  s = s.replace(/\s+Pedals?\s*$/i, '').trim();

  // 6. Descriptor pass shared with the title heuristic.
  s = s
    .replace(
      /\b(distortion|overdrive|fuzz|delay|reverb|chorus|tremolo|phaser|compressor|boost|eq|wah|looper|tuner|octave|pitch|modulation|harmonizer|multi\s*fx|effects)\s+pedal\b/i,
      '',
    )
    .replace(/(?:^|\s)Multi\s*FX\s*$/i, '')
    .replace(/(?:^|\s)Effects\s*$/i, '');

  s = trimEdges(s);
  return s.length > 0 ? s : null;
}

// ---------- Dimension parsing ----------

const IN_PER_MM = 1 / 25.4;
const IN_PER_CM = 1 / 2.54;
const IN_PER_M = 1 / 0.0254;
const MIN_INCHES = 0.5;
const MAX_INCHES = 24;

/**
 * Parse a dimension value (string or number) into inches. Returns null for
 * anything we can't confidently interpret or that falls outside the
 * sanity range. Recognized formats:
 *
 *   2.87                  -> assume inches (bare numbers in JSON-LD usually are)
 *   "2.87 in"             -> inches
 *   "2.87\""              -> inches
 *   "2.87 inches"         -> inches
 *   "73 mm"  / "73mm"     -> mm  -> inches
 *   "7.3 cm" / "7.3cm"    -> cm  -> inches
 *   { value: 73, unitCode: "MMT" }   -> structured QuantitativeValue
 *
 * The `unitCode` form uses UN/CEFACT codes that JSON-LD spec recommends:
 * `INH` = inches, `MMT` = millimetres, `CMT` = centimetres, `MTR` = metres.
 */
export function parseDimension(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    return clampInches(raw);
  }

  if (typeof raw === 'string') {
    return parseDimensionString(raw);
  }

  if (typeof raw === 'object') {
    const obj = raw as {
      value?: unknown;
      unitCode?: unknown;
      unitText?: unknown;
    };
    const value = typeof obj.value === 'number' ? obj.value : Number(obj.value);
    if (!Number.isFinite(value)) return null;
    const unit =
      (typeof obj.unitCode === 'string' ? obj.unitCode : null) ??
      (typeof obj.unitText === 'string' ? obj.unitText : null);
    if (!unit) return clampInches(value);
    return clampInches(value * unitFactor(unit));
  }

  return null;
}

function parseDimensionString(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Number + optional unit. The unit, if present, must be one of our
  // recognized suffixes; an unknown unit returns null rather than guessing.
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z"”″'']*)\s*$/.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? '').toLowerCase().replace(/[”″"]/g, 'in');
  if (unit.length === 0) return clampInches(value);
  const factor = unitFactor(unit);
  if (factor === 0) return null;
  return clampInches(value * factor);
}

function unitFactor(unit: string): number {
  const u = unit.toLowerCase().trim();
  if (
    u === 'in' ||
    u === 'inch' ||
    u === 'inches' ||
    u === 'inh' ||
    u === '"'
  ) {
    return 1;
  }
  if (
    u === 'mm' ||
    u === 'millimeter' ||
    u === 'millimetre' ||
    u === 'millimeters' ||
    u === 'millimetres' ||
    u === 'mmt'
  ) {
    return IN_PER_MM;
  }
  if (
    u === 'cm' ||
    u === 'centimeter' ||
    u === 'centimetre' ||
    u === 'centimeters' ||
    u === 'centimetres' ||
    u === 'cmt'
  ) {
    return IN_PER_CM;
  }
  if (
    u === 'm' ||
    u === 'meter' ||
    u === 'metre' ||
    u === 'meters' ||
    u === 'metres' ||
    u === 'mtr'
  ) {
    return IN_PER_M;
  }
  return 0;
}

function clampInches(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value < MIN_INCHES || value > MAX_INCHES) return null;
  return value;
}

// ---------- Strings ----------

function cleanString(s: string): string | null {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------- Query-based dimension search ----------
//
// The image source page rarely has dimensions (most picks come from eBay,
// Reverb listings, Reddit, blog posts). This pipeline runs a separate
// Brave WEB search like "{query} dimensions" and scrapes the top few
// hits — biased toward retailer / manufacturer hostnames that historically
// publish spec data, and explicitly skipping social / forum hostnames
// where extraction is unreliable.

/**
 * Hostnames known to publish structured spec data — boosted to the front
 * of the scrape list. Match is suffix-based (so `de.thomann.de` and
 * `www.sweetwater.com` both qualify). Order doesn't matter inside this set.
 */
const SPEC_DOMAINS: readonly string[] = [
  // Big retailers
  'sweetwater.com',
  'thomann.de',
  'thomannmusic.com',
  'andertons.co.uk',
  'musiciansfriend.com',
  'guitarcenter.com',
  'perfectcircuit.com',
  'longandmcquade.com',
  'equipboard.com',
  // Manufacturers (the brands in our known-brands list)
  'boss.info',
  'bossus.com',
  'strymon.net',
  'jhspedals.com',
  'jhspedals.info',
  'walrusaudio.com',
  'jimdunlop.com',
  'ehx.com',
  'wamplerpedals.com',
  'eventideaudio.com',
  'sourceaudio.net',
  'tcelectronic.com',
  'line6.com',
  'catalinbread.com',
  'maxonfx.com',
  'chasebliss.com',
  'earthquakerdevices.com',
  'empresseffects.com',
  'robertkeeley.com',
  'mooeraudio.com',
  'zvex.com',
  'wayhuge.com',
];

/**
 * Hostnames excluded from the scrape list — social media, forums, video,
 * marketplaces with extremely variable per-listing structure. Reverb is
 * here even though it's nominally a retailer: in practice its per-listing
 * pages mix in dimensions from cables, cases, and other accessories the
 * seller bundled, which leak into our label-scrape and produce false
 * positives. Manufacturer + Sweetwater pages are reliable enough; Reverb
 * isn't worth the noise.
 */
const SOCIAL_DOMAINS: readonly string[] = [
  'reverb.com',
  'reddit.com',
  'pinterest.com',
  'pin.it',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'ebay.com',
  'ebay.co.uk',
  'ebay.de',
  // ModularGrid catalogs Eurorack modules in HP (horizontal pitch, ~0.2"
  // per HP) — they reuse the spec page format for pedalboards, so a
  // search for a stompbox lands on a page whose `width` value is HP, not
  // inches, and the page's brand is "ModularGrid" via og:site_name
  // (issue #73). Reject the whole domain — it never carries useful
  // stompbox spec data.
  'modulargrid.net',
];

function normalizeHost(host: string | null): string {
  return (host ?? '').toLowerCase().replace(/^www\./, '');
}

function hostMatchesSet(host: string | null, set: readonly string[]): boolean {
  const h = normalizeHost(host);
  if (h.length === 0) return false;
  return set.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

function isSpecHost(host: string | null): boolean {
  return hostMatchesSet(host, SPEC_DOMAINS);
}

function isSocialHost(host: string | null): boolean {
  return hostMatchesSet(host, SOCIAL_DOMAINS);
}

export interface FindPedalDimensionsOptions {
  signal?: AbortSignal;
  /** Cap on pages to fetch per dimension search. Defaults to 5. */
  maxPages?: number;
  /**
   * Test seam — defaults to the live `searchPedalWeb`. Tests inject a
   * stub so they don't burn API quota / require a network.
   */
  webSearchImpl?: typeof searchPedalWeb;
  /**
   * Test seam — defaults to the live `extractPedalMetadata`. Tests inject
   * a stub that returns canned outcomes per URL.
   */
  extractImpl?: typeof extractPedalMetadata;
}

/**
 * Search the web for pages likely to carry the pedal's spec sheet, then
 * scrape the top hits. Returns the merged metadata across all results,
 * with earlier (higher-priority) hits winning on a per-field basis. When
 * no results yielded any signal, returns null so the caller can leave
 * draft fields untouched.
 *
 * Resolves rather than throws on all expected failure paths (no API key,
 * rate-limited, etc.) — only re-throws `AbortError` so user-cancel can
 * be distinguished from a real failure upstream.
 */
export async function findPedalDimensionsByQuery(
  query: string,
  options: FindPedalDimensionsOptions = {},
): Promise<ExtractedPedalMetadata | null> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;

  const webSearch = options.webSearchImpl ?? searchPedalWeb;
  const extract = options.extractImpl ?? extractPedalMetadata;
  const maxPages = options.maxPages ?? 5;

  const outcome = await webSearch(`${trimmed} dimensions`, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (outcome.kind !== 'ok') return null;

  // Drop social/forum hostnames; sort spec hostnames to the front while
  // preserving Brave's relative ranking inside each bucket.
  const filtered = outcome.results.filter((r) => !isSocialHost(r.hostname));
  const sorted = stableSort(filtered, (a, b) => {
    const aSpec = isSpecHost(a.hostname) ? 1 : 0;
    const bSpec = isSpecHost(b.hostname) ? 1 : 0;
    return bSpec - aSpec;
  });

  const top = sorted.slice(0, maxPages);
  if (top.length === 0) return null;

  const extractions = await Promise.all(
    top.map((r) =>
      extract(r.url, options.signal ? { signal: options.signal } : {})
        .then((o) => (o.kind === 'ok' ? o.metadata : null))
        .catch(() => null),
    ),
  );

  const merged: ExtractedPedalMetadata = {
    brand: null,
    name: null,
    widthIn: null,
    depthIn: null,
  };

  // Brand/name: keep simple first-source-wins per field in scrape order.
  // These signals are usually consistent across results and an earlier
  // (higher-ranked / spec-host) source is more trustworthy.
  for (const r of extractions) {
    if (!r) continue;
    if (merged.brand === null && r.brand !== null) merged.brand = r.brand;
    if (merged.name === null && r.name !== null) merged.name = r.name;
  }

  // Dimensions: take the first result that produced any dims at all —
  // `extractPedalMetadata` now drops solo dims (issue #73 round 2), so
  // every non-null pair came from a single page where both width and
  // depth sat next to each other in the spec data. That's much higher
  // confidence than stitching width from one page and depth from
  // another, where each side could be unrelated noise.
  const withDims = extractions.find(
    (r): r is ExtractedPedalMetadata =>
      r?.widthIn != null && r.depthIn !== null,
  );
  if (withDims) {
    merged.widthIn = withDims.widthIn;
    merged.depthIn = withDims.depthIn;
  }

  const hasAnySignal =
    merged.brand !== null ||
    merged.name !== null ||
    merged.widthIn !== null ||
    merged.depthIn !== null;
  return hasAnySignal ? merged : null;
}

/**
 * Array#sort isn't guaranteed to be stable across all JS engines (it is in
 * modern V8 / JSC but I'd rather not depend on that for ranking). Decorate
 * with original index, sort, undecorate.
 */
function stableSort<T>(arr: readonly T[], cmp: (a: T, b: T) => number): T[] {
  return arr
    .map((value, index) => ({ value, index }))
    .sort((a, b) => cmp(a.value, b.value) || a.index - b.index)
    .map(({ value }) => value);
}

// Re-exported so callers (e.g. tests) can build typed stub responses.
export type { BraveWebResult };
