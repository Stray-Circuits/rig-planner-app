/**
 * Module-scoped HTMLImageElement cache for bundled board renders.
 *
 * Vite gives each PNG a stable hashed URL, so we key by that URL. Cached
 * images stay alive for the session — the working set is small (19 PNGs
 * totalling ~2MB) and decoding cost is what we're avoiding, not memory.
 *
 * In jsdom (vitest) `Image` exists but doesn't actually load; tests should
 * mock callers rather than this module.
 */

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

/** Returns the image only if it's loaded and decoded. Use for the synchronous draw path. */
export function getCachedBoardImage(src: string): HTMLImageElement | null {
  const img = cache.get(src);
  if (!img) return null;
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export function loadBoardImage(src: string): Promise<HTMLImageElement> {
  const ready = getCachedBoardImage(src);
  if (ready) return Promise.resolve(ready);
  const inFlight = pending.get(src);
  if (inFlight) return inFlight;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cache.set(src, img);
      pending.delete(src);
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(src);
      reject(new Error(`Failed to load board image: ${src}`));
    };
    img.src = src;
  });
  pending.set(src, p);
  return p;
}

/** Test-only: drop the cache so a fresh load can be observed. */
export function __resetBoardImageCacheForTests(): void {
  cache.clear();
  pending.clear();
}
