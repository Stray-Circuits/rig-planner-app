import { describe, expect, it } from 'vitest';
import {
  applyColorThreshold,
  detectUniformBackground,
  dominantColor,
  findAlphaBBox,
  rgbToHex,
  sampleCornerBgColor,
} from '../src/lib/imageHelpers';

/** Build a width×height RGBA buffer with `fn` filling each pixel. */
function buildBuffer(
  width: number,
  height: number,
  fn: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = fn(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

describe('findAlphaBBox', () => {
  it('returns null when every pixel is transparent', () => {
    const data = buildBuffer(8, 8, () => [0, 0, 0, 0]);
    expect(findAlphaBBox(data, 8, 8)).toBeNull();
  });

  it('finds the tight box around a single opaque pixel', () => {
    const data = buildBuffer(10, 10, (x, y) =>
      x === 3 && y === 5 ? [0, 0, 0, 255] : [0, 0, 0, 0],
    );
    expect(findAlphaBBox(data, 10, 10)).toEqual({
      minX: 3,
      minY: 5,
      maxX: 3,
      maxY: 5,
    });
  });

  it('finds a 4×3 opaque rectangle', () => {
    const data = buildBuffer(10, 10, (x, y) =>
      x >= 2 && x <= 5 && y >= 4 && y <= 6 ? [0, 0, 0, 255] : [0, 0, 0, 0],
    );
    expect(findAlphaBBox(data, 10, 10)).toEqual({
      minX: 2,
      minY: 4,
      maxX: 5,
      maxY: 6,
    });
  });

  it('honors the alpha threshold — sub-threshold fringe is ignored', () => {
    // Center pixel is opaque; ring around it is alpha=4 (fringe).
    const data = buildBuffer(5, 5, (x, y) => {
      if (x === 2 && y === 2) return [0, 0, 0, 255];
      if (Math.abs(x - 2) <= 1 && Math.abs(y - 2) <= 1) return [0, 0, 0, 4];
      return [0, 0, 0, 0];
    });
    expect(findAlphaBBox(data, 5, 5, 8)).toEqual({
      minX: 2,
      minY: 2,
      maxX: 2,
      maxY: 2,
    });
    // Lower threshold → fringe is in-bounds.
    expect(findAlphaBBox(data, 5, 5, 0)).toEqual({
      minX: 1,
      minY: 1,
      maxX: 3,
      maxY: 3,
    });
  });
});

describe('sampleCornerBgColor', () => {
  it('averages the 4 inset corner pixels', () => {
    // 200×200 — inset = max(2, round(200 × 0.01)) = max(2, 2) = 2.
    // Make all 4 corners (at inset=2) different colors; rest is black.
    const data = buildBuffer(200, 200, (x, y) => {
      if (x === 2 && y === 2) return [200, 100, 50, 255];
      if (x === 197 && y === 2) return [40, 80, 120, 255];
      if (x === 2 && y === 197) return [100, 200, 80, 255];
      if (x === 197 && y === 197) return [80, 80, 150, 255];
      return [0, 0, 0, 255];
    });
    const bg = sampleCornerBgColor(data, 200, 200);
    expect(bg.r).toBe((200 + 40 + 100 + 80) / 4);
    expect(bg.g).toBe((100 + 80 + 200 + 80) / 4);
    expect(bg.b).toBe((50 + 120 + 80 + 150) / 4);
  });
});

describe('applyColorThreshold', () => {
  it('zeros alpha for pixels near the background color', () => {
    // 2×2 image: (0,0) matches bg exactly, others don't.
    const data = buildBuffer(2, 2, (x, y) => {
      if (x === 0 && y === 0) return [255, 255, 255, 255]; // bg
      return [0, 0, 0, 255]; // pedal
    });
    applyColorThreshold(data, { r: 255, g: 255, b: 255 }, 0.05);
    expect(data[3]).toBe(0); // bg pixel now transparent
    expect(data[7]).toBe(255); // pedal pixel preserved
    expect(data[11]).toBe(255);
    expect(data[15]).toBe(255);
  });

  it('tolerance=0 leaves nearly-but-not-exactly-bg pixels alone', () => {
    const data = buildBuffer(1, 1, () => [250, 250, 250, 255]);
    applyColorThreshold(data, { r: 255, g: 255, b: 255 }, 0);
    expect(data[3]).toBe(255);
  });

  it('tolerance=1 erases every pixel', () => {
    const data = buildBuffer(2, 1, (x) =>
      x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );
    applyColorThreshold(data, { r: 128, g: 128, b: 128 }, 1);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(0);
  });
});

describe('dominantColor', () => {
  it('averages opaque pixels and ignores transparent ones', () => {
    // 8×8 buffer: left half is red+opaque, right half is white+transparent.
    const data = buildBuffer(8, 8, (x) =>
      x < 4 ? [200, 50, 50, 255] : [255, 255, 255, 0],
    );
    const rgb = dominantColor(data, 8, 8);
    expect(rgb).not.toBeNull();
    // Only the red pixels should contribute; allow small slop.
    expect(rgb!.r).toBeCloseTo(200, 0);
    expect(rgb!.g).toBeCloseTo(50, 0);
    expect(rgb!.b).toBeCloseTo(50, 0);
  });

  it('returns null when every pixel is below the alpha threshold', () => {
    const data = buildBuffer(4, 4, () => [255, 0, 0, 8]);
    expect(dominantColor(data, 4, 4)).toBeNull();
  });

  it('rgbToHex packs floats into a lowercase #rrggbb string', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 128 })).toBe('#ff0080');
    expect(rgbToHex({ r: 200.7, g: 50.3, b: 50 })).toBe('#c93232');
  });
});

describe('detectUniformBackground', () => {
  it('returns a tolerance when border pixels are uniform', () => {
    const data = buildBuffer(64, 64, () => [240, 240, 240, 255]);
    const detected = detectUniformBackground(data, 64, 64);
    expect(detected).not.toBeNull();
    expect(detected!.tolerance).toBeGreaterThan(0);
  });

  it('returns null when border pixels vary widely (busy background)', () => {
    const data = buildBuffer(64, 64, (x, y) => [
      (x * 17 + y * 31) % 256,
      (x * 13 + y * 23) % 256,
      (x * 7 + y * 11) % 256,
      255,
    ]);
    expect(detectUniformBackground(data, 64, 64)).toBeNull();
  });

  it('still detects uniform borders when the center has high variance (subject in middle)', () => {
    // White ring with noisy 32×32 center — exactly the product-shot pattern
    // the fast path is meant to catch.
    const data = buildBuffer(64, 64, (x, y) => {
      const inBorder = x < 12 || x >= 52 || y < 12 || y >= 52;
      if (inBorder) return [250, 250, 250, 255];
      return [(x * 41) % 256, (y * 23) % 256, ((x + y) * 13) % 256, 255];
    });
    expect(detectUniformBackground(data, 64, 64)).not.toBeNull();
  });

  it('returns null for very small images where the heuristic isn’t reliable', () => {
    const data = buildBuffer(16, 16, () => [240, 240, 240, 255]);
    expect(detectUniformBackground(data, 16, 16)).toBeNull();
  });
});
