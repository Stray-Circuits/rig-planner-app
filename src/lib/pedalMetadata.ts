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

  // Low: page <title> heuristic against known brands.
  const fromTitle = extractFromTitle(doc);
  mergeMetadata(merged, fromTitle);

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
    const value = parseDimension(`${m[2]} ${m[3]}`);
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
    get('meta[property="og:brand"]') ??
    get('meta[property="og:site_name"]');

  const name =
    get('meta[property="og:title"]') ??
    get('meta[name="twitter:title"]') ??
    get('meta[property="product:name"]');

  return {
    ...(brand !== null ? { brand } : {}),
    ...(name !== null ? { name } : {}),
  };
}

// ---------- Title heuristic ----------

function extractFromTitle(doc: Document): Partial<ExtractedPedalMetadata> {
  const titleEl = doc.querySelector('title');
  const raw = titleEl?.textContent;
  if (!raw) return {};
  const title = cleanString(raw);
  if (!title) return {};

  const lower = title.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    const idx = lower.indexOf(brand.toLowerCase());
    if (idx < 0) continue;
    // Slice the model out of whatever follows the brand. Strip common
    // trailing fluff (" | Reverb", " - Sweetwater", "Distortion Pedal").
    const after = title.slice(idx + brand.length).trim();
    const model = trimTitleTail(after);
    return {
      brand,
      ...(model.length > 0 ? { name: model } : {}),
    };
  }
  return {};
}

// Padded dashes / pipes / bullets split the title tail; bare hyphens don't
// (otherwise "DS-1" becomes "DS"). Colon is fine without padding.
const TITLE_SEPARATORS = /\s+[|\-–—·]\s+|:/;

function trimTitleTail(s: string): string {
  // Cut at the first separator (Reverb / Sweetwater pages do "Boss DS-1 | Reverb").
  const split = s.split(TITLE_SEPARATORS)[0]?.trim() ?? '';
  // Drop common descriptors so "DS-1 Distortion Pedal" -> "DS-1".
  return split
    .replace(
      /\b(distortion|overdrive|fuzz|delay|reverb|chorus|tremolo|phaser|compressor|boost|eq|wah|looper|tuner|octave|pitch|modulation)\s+pedal\b/i,
      '',
    )
    .replace(/\bpedal\b/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

  // Dimensions: prefer the first result that returned BOTH width and depth
  // over a result that returned just one. The reason is asymmetric trust:
  // when a page only surfaces ONE dimension, it often means the regex
  // matched something incidental (e.g. "1 in/out" jacks count, an
  // accessory's spec, a band-width spec) rather than the pedal's actual
  // footprint. A result with BOTH width and depth almost always came from
  // a real spec table where the two were sitting next to each other —
  // much higher confidence. Concrete case: Wampler Mini Ego 76 was
  // returning widthIn=1 with no depth from one page, while a different
  // page had both correct values; the complete one should win wholesale.
  const complete = extractions.find(
    (r): r is ExtractedPedalMetadata =>
      r?.widthIn != null && r.depthIn !== null,
  );
  if (complete) {
    merged.widthIn = complete.widthIn;
    merged.depthIn = complete.depthIn;
  } else {
    // No source has both — fall back to per-field first-wins.
    for (const r of extractions) {
      if (!r) continue;
      if (merged.widthIn === null && r.widthIn !== null) {
        merged.widthIn = r.widthIn;
      }
      if (merged.depthIn === null && r.depthIn !== null) {
        merged.depthIn = r.depthIn;
      }
    }
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
