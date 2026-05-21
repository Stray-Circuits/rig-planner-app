/**
 * Pure pixel-buffer helpers used by the canvas wrappers in bgRemoval.ts.
 *
 * The wrappers are async and depend on the DOM (createImageBitmap, canvas) so
 * they can't run under jsdom. Splitting the inner loops out lets us unit-test
 * the actual algorithms over `Uint8ClampedArray` without a browser.
 */

export interface AlphaBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Returns the tight bounding box of pixels whose alpha exceeds `threshold`.
 * Returns null if every pixel is at or below the threshold (i.e. fully empty).
 */
export function findAlphaBBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 8,
): AlphaBBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Sample 4 corner pixels (inset slightly) and average their RGB. This gives
 * a stable background-color estimate for chroma-key style removal.
 */
export function sampleCornerBgColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { r: number; g: number; b: number } {
  const inset = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0] as const;
  };
  const corners = [
    at(inset, inset),
    at(width - 1 - inset, inset),
    at(inset, height - 1 - inset),
    at(width - 1 - inset, height - 1 - inset),
  ];
  return {
    r: corners.reduce((s, c) => s + c[0], 0) / 4,
    g: corners.reduce((s, c) => s + c[1], 0) / 4,
    b: corners.reduce((s, c) => s + c[2], 0) / 4,
  };
}

/**
 * Average RGB of every pixel whose alpha is above the threshold. Used to
 * pick a "fallback" tint for a pedal — the color we show on the board
 * canvas when the user's chosen view doesn't actually load the photo.
 *
 * Returns null if no pixel is opaque enough — caller should keep the
 * existing color in that case.
 */
export function dominantColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 64,
): { r: number; g: number; b: number } | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  // Subsample for speed — every 4th pixel along each axis is plenty for an
  // average and keeps this O(n/16) on a 1K image.
  const stride = 4;
  for (let y = 0; y < height; y += stride) {
    const row = y * width;
    for (let x = 0; x < width; x += stride) {
      const i = (row + x) * 4;
      const a = data[i + 3] ?? 0;
      if (a <= alphaThreshold) continue;
      r += data[i] ?? 0;
      g += data[i + 1] ?? 0;
      b += data[i + 2] ?? 0;
      n += 1;
    }
  }
  if (n === 0) return null;
  return { r: r / n, g: g / n, b: b / n };
}

/** Pack an {r,g,b} (0..255) into a lowercase `#rrggbb` hex string. */
export function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const to2 = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`;
}

/**
 * In-place: zero the alpha channel of any pixel whose RGB distance from
 * `bg` is below `tolerance × max-distance` (max-distance = sqrt(3) × 255).
 *
 * tolerance is 0..1 — 0 only erases pixels essentially identical to bg,
 * 1 erases everything.
 */
export function applyColorThreshold(
  data: Uint8ClampedArray,
  bg: { r: number; g: number; b: number },
  tolerance: number,
): void {
  const maxDist = Math.sqrt(3) * 255;
  const threshold = tolerance * maxDist;
  const sqThreshold = threshold * threshold;
  for (let i = 0; i < data.length; i += 4) {
    const dr = (data[i] ?? 0) - bg.r;
    const dg = (data[i + 1] ?? 0) - bg.g;
    const db = (data[i + 2] ?? 0) - bg.b;
    if (dr * dr + dg * dg + db * db < sqThreshold) {
      data[i + 3] = 0;
    }
  }
}
