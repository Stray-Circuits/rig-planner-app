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
  | 'loading-library' // dynamic-importing @imgly/background-removal
  | 'fetching-model' // first-time model download
  | 'processing'; // running inference

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
  const mod = await import('@imgly/background-removal');

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // The library has a single progress callback that fires for both model
  // download and inference. We translate that into our two-phase shape.
  let phase: BgRemovalPhase = 'fetching-model';
  const result = await mod.removeBackground(source, {
    output: { format: 'image/png', quality: 1 },
    progress: (key: string, current: number, total: number) => {
      // Library keys look like `fetch:<filename>` while downloading and
      // `compute:onnxruntime/...` once inference starts.
      if (key.startsWith('compute')) {
        phase = 'processing';
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
 * Resize a Blob image (canvas-based) so its long side is at most maxPx. We
 * pre-shrink uploads before bg removal both for speed and to keep the data
 * URL we eventually store small enough for localStorage (browser dev mode)
 * and reasonable for SQLite (Tauri).
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
