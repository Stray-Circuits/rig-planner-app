/**
 * Brave Search API client for the in-app pedal photo search.
 *
 * See proposals/pedal-photo-search.md for the design context. The decision
 * trail (key baked at build time, no in-app user-supplied-key field, render
 * results in our own grid) lives there.
 *
 * The API key is read from `import.meta.env.VITE_BRAVE_SEARCH_API_KEY` at
 * build time. When the key is absent (open-source rebuilds, local dev
 * without `.env.local`) `searchPedalImages` returns `{ kind: 'disabled' }`
 * so callers can hide the affordance gracefully instead of erroring.
 *
 * Transport: under Tauri, requests are routed through `@tauri-apps/plugin-http`
 * which proxies through Rust and bypasses CORS — required because Brave's API
 * doesn't advertise CORS headers and most image hosts don't either. In plain
 * browser dev (`pnpm dev`) we fall back to the platform `fetch`, which will
 * fail with a CORS-shaped network error for most URLs; the UI surfaces that
 * cleanly so the user knows search isn't available outside the Tauri build.
 */

const ENDPOINT = 'https://api.search.brave.com/res/v1/images/search';
const DEFAULT_COUNT = 20;

/**
 * Pick the right `fetch` for the current environment. Under Tauri, lazy-load
 * the HTTP plugin so the import isn't pulled into the bundle for browser
 * builds that can't use it. The result is cached because the dynamic import
 * is cheap on hits but isn't free, and we'll call this on every search +
 * image fetch.
 */
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

export interface BraveImageResult {
  /** Page title from Brave's index — useful as accessible alt text. */
  title: string;
  /** Full-size image URL to fetch + run through bg-removal once picked. */
  imageUrl: string;
  /** Brave-cached thumbnail URL — fast to render in the results grid. */
  thumbnailUrl: string;
  /** Page where the image lives — stored as `Pedal.imageSourceUrl`. */
  sourceUrl: string;
  /** Pixel dimensions when Brave reports them; null otherwise. */
  width: number | null;
  height: number | null;
}

/**
 * Discriminated outcome so callers can render distinct UI for each case
 * without parsing exception messages.
 */
export type BraveSearchOutcome =
  | { kind: 'ok'; results: BraveImageResult[] }
  /** No API key was baked into the build — feature is intentionally off. */
  | { kind: 'disabled' }
  /** Query was empty/whitespace — short-circuit, don't hit the API. */
  | { kind: 'empty_query' }
  /** 429 from Brave — monthly/per-second quota hit. */
  | { kind: 'rate_limited' }
  /** 401/403 — built-in key is invalid/revoked/scoped wrong. */
  | { kind: 'unauthorized' }
  /** Anything else server-side (5xx, unexpected 4xx). */
  | { kind: 'server_error'; status: number }
  /** fetch threw — DNS, CORS, offline, abort, etc. */
  | { kind: 'network_error'; message: string };

export interface SearchPedalImagesOptions {
  signal?: AbortSignal;
  /** How many results to ask Brave for. Defaults to 20. */
  count?: number;
  /**
   * Test seam: inject a fetch implementation. Production callers always
   * leave this undefined and the platform `fetch` is used.
   */
  fetchImpl?: typeof fetch;
  /**
   * Test seam: override the API key. Production callers always leave this
   * undefined; the key is read from `import.meta.env`.
   */
  apiKey?: string;
}

/**
 * Read the build-time-baked Brave API key. Exported for tests only. Returns
 * undefined when the env var was unset at build time.
 */
export function readBraveApiKey(): string | undefined {
  const env = import.meta.env as Record<string, unknown>;
  const raw = env.VITE_BRAVE_SEARCH_API_KEY;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True iff a key was baked into the build — useful for hiding affordances. */
export function isBraveSearchConfigured(): boolean {
  return readBraveApiKey() !== undefined;
}

interface RawThumbnail {
  src?: unknown;
  original?: unknown;
}

interface RawProperties {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface RawResult {
  title?: unknown;
  url?: unknown;
  thumbnail?: RawThumbnail | null;
  properties?: RawProperties | null;
  source?: unknown;
}

interface RawResponse {
  results?: RawResult[];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

/**
 * Map a single raw Brave result row to our typed shape. Returns null when
 * the row is missing the fields we need to render and use it (image URL,
 * source URL). Skipped rows are dropped from the final list rather than
 * surfacing a partial render.
 */
function parseResult(raw: RawResult): BraveImageResult | null {
  // Brave puts the full image at `properties.url` and the brave-cached
  // thumbnail at `thumbnail.src`. We need both. The page URL is the
  // top-level `url` — that's what we save as `imageSourceUrl`. Full-image
  // pixel dimensions live under `properties.width/height`, NOT at the top
  // level (that mistake bit us once already — see live response fixture).
  const imageUrl = asString(raw.properties?.url);
  const thumbnailUrl =
    asString(raw.thumbnail?.src) ?? asString(raw.thumbnail?.original);
  const sourceUrl = asString(raw.url);
  if (!imageUrl || !thumbnailUrl || !sourceUrl) return null;
  return {
    title: asString(raw.title) ?? '',
    imageUrl,
    thumbnailUrl,
    sourceUrl,
    width: asPositiveInt(raw.properties?.width),
    height: asPositiveInt(raw.properties?.height),
  };
}

/**
 * Search for pedal images by query string. Always resolves — failures are
 * returned as discriminated outcomes, never thrown. The exception is
 * `AbortError`, which is re-thrown so callers can distinguish user-cancel
 * from a real failure.
 */
export async function searchPedalImages(
  query: string,
  options: SearchPedalImagesOptions = {},
): Promise<BraveSearchOutcome> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { kind: 'empty_query' };

  const apiKey = options.apiKey ?? readBraveApiKey();
  if (apiKey === undefined) return { kind: 'disabled' };

  const count = options.count ?? DEFAULT_COUNT;
  const fetchImpl = options.fetchImpl ?? (await platformFetch());
  const url = `${ENDPOINT}?q=${encodeURIComponent(trimmed)}&count=${count}&safesearch=strict`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return {
      kind: 'network_error',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (response.status === 429) return { kind: 'rate_limited' };
  if (response.status === 401 || response.status === 403) {
    return { kind: 'unauthorized' };
  }
  if (!response.ok) return { kind: 'server_error', status: response.status };

  let parsed: RawResponse;
  try {
    parsed = (await response.json()) as RawResponse;
  } catch (err) {
    return {
      kind: 'server_error',
      status: response.status,
      ...{ message: err instanceof Error ? err.message : String(err) },
    };
  }

  const results: BraveImageResult[] = [];
  for (const raw of parsed.results ?? []) {
    const mapped = parseResult(raw);
    if (mapped) results.push(mapped);
  }
  return { kind: 'ok', results };
}

/**
 * Map common image extensions to MIME types. Brave returns image URLs from
 * arbitrary hosts; some serve images via paths without extensions
 * (`?id=…&fmt=…`) but the dominant case is a well-formed file path. Only
 * formats that `createImageBitmap` + the imgly model accept are listed —
 * if we can't recognize an extension we fall through to the magic-byte
 * sniff below so we don't reject otherwise-valid blobs.
 */
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

function mimeFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const dot = path.lastIndexOf('.');
    if (dot < 0) return null;
    const ext = path.slice(dot + 1);
    return EXT_TO_MIME[ext] ?? null;
  } catch {
    return null;
  }
}

/**
 * Sniff a few common image formats from the first bytes. Lets us recover
 * when neither the response header nor the URL extension tells us the
 * format — for example, when an image host serves a JPEG behind a
 * `?id=…` path with no extension and `Content-Type: application/octet-stream`.
 */
function mimeFromMagic(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif';
  }
  return null;
}

/**
 * Fetch a single image URL the user picked from the results grid and return
 * it as a Blob ready to feed into the bg-removal pipeline.
 *
 * The returned blob always carries a recognized `image/*` MIME type — the
 * bg-removal pipeline calls `createImageBitmap` + imgly, both of which
 * reject blobs without a proper image type ("Invalid format" being the
 * imgly variant). The Tauri HTTP plugin can pass blobs through with an
 * empty `type` for hosts that omit Content-Type, so we re-wrap with a
 * sniffed type if needed.
 *
 * Failures resolve to `null` so callers can surface a generic "couldn't
 * download — try a different image" message rather than throwing.
 */
export async function fetchImageAsBlob(
  url: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Blob | null> {
  const fetchImpl = options.fetchImpl ?? (await platformFetch());
  try {
    const response = await fetchImpl(url, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) return null;
    // Pull bytes off the Response itself rather than via blob.arrayBuffer().
    // Older runtimes (jsdom) lack Blob.arrayBuffer; the Response variant is
    // universal — and we always need the bytes anyway to pick a MIME type.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) return null;

    const headerType =
      response.headers
        .get('content-type')
        ?.split(';')[0]
        ?.trim()
        .toLowerCase() ?? '';

    // Best signal: a well-formed `image/*` header. Use it.
    if (headerType.startsWith('image/')) {
      return new Blob([bytes], { type: headerType });
    }

    // Header missing or non-image (some hosts send octet-stream). Try the
    // URL extension first, then magic bytes. If nothing matches, bail —
    // feeding random bytes to the bg-removal model just throws later.
    const urlType = mimeFromUrl(url);
    if (urlType) return new Blob([bytes], { type: urlType });

    const magicType = mimeFromMagic(bytes);
    if (magicType) return new Blob([bytes], { type: magicType });

    return null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return null;
  }
}
