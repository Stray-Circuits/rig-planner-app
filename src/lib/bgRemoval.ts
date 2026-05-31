import BgRemovalWorker from './bgRemovalWorker?worker';
import type { WorkerOutbound } from './bgRemovalWorker';
import {
  applyColorThreshold,
  dominantColor,
  findAlphaBBox,
  rgbToHex,
  sampleCornerBgColor,
} from './imageHelpers';

/**
 * Background-removal wrapper around `@imgly/background-removal`.
 *
 * The library only proxies inference to a worker when device='gpu', and
 * WebGPU on Android WebView is slower than CPU quint8 (issue #23 traces).
 * So we wrap our own dedicated worker (`./bgRemovalWorker.ts`) and run the
 * lib in CPU mode there — keeps the ~14s inference off the main thread.
 *
 * Returns a transparent-background PNG as a Blob. Callers can convert with
 * `URL.createObjectURL` or `blobToDataURL` (below).
 */

export type BgRemovalPhase =
  | 'preparing-image' // shrinking + decoding the upload
  | 'loading-library' // spinning up the worker
  | 'initializing-runtime' // library loaded but ORT/WASM still warming up
  | 'fetching-model' // first-time model download
  | 'processing' // running inference
  | 'finalizing'; // cropping + encoding the result

export interface BgRemovalProgress {
  phase: BgRemovalPhase;
  /** 0..1 when known; null while indeterminate. */
  fraction: number | null;
}

export interface RemoveBackgroundOptions {
  onProgress?: (p: BgRemovalProgress) => void;
  signal?: AbortSignal;
}

// One long-lived worker shared across all bg-removal calls. The library's
// model bytes, parsed ONNX graph, and ORT WASM runtime live in this worker's
// module-level state. Spawning a fresh worker per call would re-download the
// model (the lib has no persistent caching of its own — pure `fetch()`).
let sharedWorker: Worker | null = null;
function getWorker(): Worker | null {
  if (sharedWorker) return sharedWorker;
  try {
    sharedWorker = new BgRemovalWorker();
    return sharedWorker;
  } catch {
    // Worker unavailable (e.g. test env).
    return null;
  }
}
function disposeWorker(): void {
  sharedWorker?.terminate();
  sharedWorker = null;
}

/**
 * Run background removal on a File or Blob. Resolves to a transparent PNG
 * Blob; rejects if the user cancels via the AbortSignal or if the worker
 * fails to load. Calls are serialized through the shared worker — overlapping
 * invocations would clobber each other's message handlers.
 */
export async function removeBackground(
  source: Blob,
  opts: RemoveBackgroundOptions = {},
): Promise<Blob> {
  const { onProgress, signal } = opts;

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  onProgress?.({ phase: 'loading-library', fraction: null });
  const worker = getWorker();
  if (!worker) {
    throw new Error('Web Worker unavailable in this environment');
  }

  return new Promise<Blob>((resolve, reject) => {
    let phase: BgRemovalPhase = 'initializing-runtime';

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      // Can't surgically cancel an in-flight inference inside the worker;
      // terminate so a fresh worker spawns next call.
      disposeWorker();
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort);

    worker.onerror = (e) => {
      // Worker may be in a broken state; drop the shared ref.
      disposeWorker();
      cleanup();
      reject(new Error(e.message || 'Worker error'));
    };
    worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        // Library keys look like `fetch:<filename>` while downloading and
        // `compute:onnxruntime/...` once inference starts.
        if (msg.key.startsWith('compute')) phase = 'processing';
        else if (msg.key.startsWith('fetch')) phase = 'fetching-model';
        const fraction = msg.total > 0 ? msg.current / msg.total : null;
        onProgress?.({ phase, fraction });
      } else if (msg.type === 'result') {
        cleanup();
        resolve(msg.blob);
      } else {
        cleanup();
        reject(new Error(msg.message));
      }
    };

    onProgress?.({ phase: 'initializing-runtime', fraction: null });
    worker.postMessage({ source });
  });
}

/**
 * Pre-spawn the shared bg-removal worker so the lib + ORT WASM import is
 * warm by the time the user picks a file. Idempotent.
 */
export function prefetchBgRemoval(): void {
  getWorker();
}

/**
 * True when the current connection looks like one a user would want a warning
 * before before we burn ~176MB on a model download. Uses the Network
 * Information API (`navigator.connection`); on browsers without it we err on
 * the side of NOT warning, since most desktop browsers don't expose it.
 */
export function isMeteredConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  // The Network Information API isn't in lib.dom yet; cast through unknown.
  const conn = (
    navigator as unknown as {
      connection?: {
        type?: string;
        effectiveType?: string;
        saveData?: boolean;
      };
    }
  ).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  if (conn.type === 'cellular') return true;
  return false;
}

const MODEL_DOWNLOADED_KEY = 'rig-planner-bg-model-downloaded';

/** True iff a previous run completed a successful model fetch on this origin. */
export function hasDownloadedModel(): boolean {
  try {
    return localStorage.getItem(MODEL_DOWNLOADED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mark the model as cached so we stop warning about its download. */
export function markModelDownloaded(): void {
  try {
    localStorage.setItem(MODEL_DOWNLOADED_KEY, '1');
  } catch {
    /* localStorage full or unavailable — best effort */
  }
}

const IMAGE_DECODE_HINTS = [
  'createimagebitmap',
  'source image could not be decoded',
  'the image source is not supported',
  'invalid image',
];

/**
 * Map a thrown error from the image pipeline to a message that's actually
 * actionable. The big offender is HEIC from iOS: createImageBitmap throws
 * a generic "Cannot decode" in Chromium, "type not supported" in Safari.
 * Returns the original error message when we don't recognize the cause.
 */
export function describeImageError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Canceled.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (IMAGE_DECODE_HINTS.some((hint) => lower.includes(hint))) {
    return "We couldn't decode that image — try JPEG or PNG. HEIC photos from iOS aren't supported in the browser yet.";
  }
  return msg;
}

/**
 * Sample the dominant non-transparent color of a (probably transparent-
 * background) image as a `#rrggbb` hex string. Used to pick a fallback
 * tint for a pedal whose image is its primary representation — the
 * board can then show that tint behind the photo (and as a placeholder
 * if the photo ever fails to load).
 *
 * Returns null if nothing in the image is opaque enough to read.
 */
export async function sampleDominantImageColor(
  blob: Blob,
): Promise<string | null> {
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, w, h);
  const rgb = dominantColor(data, w, h);
  return rgb ? rgbToHex(rgb) : null;
}

/** Convert a Blob (e.g. the removeBackground result) to a data: URL. */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader error'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/**
 * Crop a transparent PNG (e.g. the removeBackground result) to the bounding
 * box of non-transparent pixels, with a small padding. Without this, the
 * model leaves the original dimensions intact — empty backgrounds become
 * transparent margins that shrink the visible pedal when CSS `contain`s the
 * result into a smaller container.
 */
export async function cropToContent(blob: Blob, paddingPx = 1): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return blob;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const { data } = ctx.getImageData(0, 0, w, h);
  const bbox = findAlphaBBox(data, w, h);
  if (!bbox) return blob;

  const x0 = Math.max(0, bbox.minX - paddingPx);
  const y0 = Math.max(0, bbox.minY - paddingPx);
  const x1 = Math.min(w, bbox.maxX + 1 + paddingPx);
  const y1 = Math.min(h, bbox.maxY + 1 + paddingPx);
  const cw = x1 - x0;
  const ch = y1 - y0;

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d');
  if (!octx) return blob;
  octx.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return new Promise<Blob>((resolve, reject) => {
    out.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('toBlob returned null'));
      },
      'image/png',
      0.92,
    );
  });
}

/**
 * Chroma-key style background removal. Samples the four corner pixels of
 * the image to estimate the background color, then makes any pixel whose
 * RGB distance to that color is under `tolerance × max-distance` transparent.
 *
 * Works well for photos with a roughly uniform background (e.g. a white pedal
 * on a white sheet of paper where the two whites are still visibly different)
 * — exactly the case ISNet conflates. Failure mode: a busy background, or a
 * pedal that shares its main color with the background to within tolerance.
 *
 * `tolerance` is 0..1, where 0 removes only pixels essentially identical to
 * the corner color and 1 removes everything.
 */
export async function removeColorThreshold(
  source: Blob,
  tolerance: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return source;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const imgData = ctx.getImageData(0, 0, w, h);
  const bg = sampleCornerBgColor(imgData.data, w, h);
  applyColorThreshold(imgData.data, bg, tolerance);
  ctx.putImageData(imgData, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('toBlob returned null'));
    }, 'image/png');
  });
}

/**
 * Resize a Blob image (canvas-based) so its long side is at most maxPx. We
 * pre-shrink uploads before bg removal so the model isn't asked to chew on
 * a 12MP raw camera frame, and to keep the resulting data URL we store
 * within reason. 1024 matches imgly's default ISNet input resolution —
 * smaller throws away detail the model could otherwise use.
 */
export async function shrinkImage(source: Blob, maxPx: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= maxPx) {
    bitmap.close?.();
    return source;
  }
  const scale = maxPx / longest;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return source;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('toBlob returned null'));
      },
      'image/png',
      0.92,
    );
  });
}
