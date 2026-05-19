/**
 * Background-removal wrapper around `@imgly/background-removal`.
 *
 * The underlying library lazy-loads a ~176MB U²Net model on first use,
 * caches it in IndexedDB, and prefers WebGPU with a WASM fallback. We import
 * it dynamically so the model worker / wasm assets aren't part of the
 * critical bundle.
 *
 * Returns a transparent-background PNG as a Blob. Callers can convert with
 * `URL.createObjectURL` or `blobToDataURL` (below).
 */

export type BgRemovalPhase =
  | 'preparing-image' // shrinking + decoding the upload
  | 'loading-library' // dynamic-importing @imgly/background-removal
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

/**
 * Run background removal on a File or Blob. Resolves to a transparent PNG
 * Blob; rejects if the user cancels via the AbortSignal or if loading the
 * library fails.
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

  // Dynamic import — keeps the heavy lib out of the initial bundle.
  // If we prefetched earlier this resolves instantly; first-time it's the
  // ~22KB imgly chunk + ~109KB ORT JS.
  const mod = await import('@imgly/background-removal');

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // The library doesn't expose a "runtime ready" event — calling
  // removeBackground triggers ORT WASM instantiation under the hood. This
  // can take a few seconds with no visible progress; surface that as its
  // own phase so the user doesn't sit on a stale "Loading…" forever.
  onProgress?.({ phase: 'initializing-runtime', fraction: null });

  let phase: BgRemovalPhase = 'initializing-runtime';
  const result = await mod.removeBackground(source, {
    output: { format: 'image/png', quality: 1 },
    progress: (key: string, current: number, total: number) => {
      // Library keys look like `fetch:<filename>` while downloading and
      // `compute:onnxruntime/...` once inference starts.
      if (key.startsWith('compute')) {
        phase = 'processing';
      } else if (key.startsWith('fetch')) {
        phase = 'fetching-model';
      }
      const fraction = total > 0 ? current / total : null;
      onProgress?.({ phase, fraction });
    },
  });

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  return result;
}

/**
 * Kick off the bg-removal library load in the background. Safe to call
 * repeatedly — the dynamic-import cache de-dupes. Use this from the wizard's
 * image step so the chunk is ready by the time the user picks a file.
 */
export function prefetchBgRemoval(): void {
  // Best-effort; ignore failures so a flaky network doesn't crash the wizard.
  void import('@imgly/background-removal').catch(() => undefined);
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
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  // Alpha threshold of 8 ignores near-transparent fringes the model often
  // leaves around the silhouette edge.
  const threshold = 8;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return blob;

  const x0 = Math.max(0, minX - paddingPx);
  const y0 = Math.max(0, minY - paddingPx);
  const x1 = Math.min(w, maxX + 1 + paddingPx);
  const y1 = Math.min(h, maxY + 1 + paddingPx);
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
