import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  clampCrop,
  rotatedCanvasSize,
  transformIsIdentity,
} from '../src/lib/imageEdit';

describe('rotatedCanvasSize', () => {
  it('returns source dims at 0 rotation', () => {
    expect(
      rotatedCanvasSize(100, 60, { quarterTurns: 0, fineAngleDeg: 0 }),
    ).toEqual({ w: 100, h: 60 });
  });

  it('swaps W/H on a single quarter turn', () => {
    expect(
      rotatedCanvasSize(100, 60, { quarterTurns: 1, fineAngleDeg: 0 }),
    ).toEqual({ w: 60, h: 100 });
    expect(
      rotatedCanvasSize(100, 60, { quarterTurns: 3, fineAngleDeg: 0 }),
    ).toEqual({ w: 60, h: 100 });
  });

  it('preserves W/H on a half turn', () => {
    expect(
      rotatedCanvasSize(100, 60, { quarterTurns: 2, fineAngleDeg: 0 }),
    ).toEqual({ w: 100, h: 60 });
  });

  it('expands canvas to fit a fine-angle rotation', () => {
    const { w, h } = rotatedCanvasSize(100, 100, {
      quarterTurns: 0,
      fineAngleDeg: 45,
    });
    // 100×100 rotated 45° fits in a √2·100 ≈ 141.42 bbox both ways.
    // cos(45°) === sin(45°) so the 0.5 ties round toward even — 141.
    expect(w).toBe(141);
    expect(h).toBe(141);
  });

  it('composes quarter turn + fine angle', () => {
    const { w, h } = rotatedCanvasSize(100, 60, {
      quarterTurns: 1,
      fineAngleDeg: 30,
    });
    // 60×100 base, rotated 30°: w = 60·cos30 + 100·sin30 ≈ 51.96 + 50 = 101.96
    // h = 60·sin30 + 100·cos30 ≈ 30 + 86.60 = 116.60
    expect(w).toBe(102);
    expect(h).toBe(117);
  });
});

describe('clampCrop', () => {
  it('returns null for null input', () => {
    expect(clampCrop(null, 100, 100)).toBeNull();
  });

  it('returns null when crop covers the whole canvas', () => {
    expect(clampCrop({ x: 0, y: 0, w: 100, h: 100 }, 100, 100)).toBeNull();
  });

  it('clamps negative origin into bounds', () => {
    expect(clampCrop({ x: -10, y: -5, w: 50, h: 50 }, 100, 100)).toEqual({
      x: 0,
      y: 0,
      w: 50,
      h: 50,
    });
  });

  it('clamps oversized crop to canvas bounds', () => {
    expect(clampCrop({ x: 80, y: 80, w: 50, h: 50 }, 100, 100)).toEqual({
      x: 80,
      y: 80,
      w: 20,
      h: 20,
    });
  });

  it('keeps at least 1×1 even for a degenerate rect', () => {
    expect(clampCrop({ x: 100, y: 100, w: 0, h: 0 }, 100, 100)).toEqual({
      x: 100,
      y: 100,
      w: 1,
      h: 1,
    });
  });
});

describe('transformIsIdentity', () => {
  it('true for the identity transform', () => {
    expect(transformIsIdentity(IDENTITY_TRANSFORM)).toBe(true);
  });

  it('false when any field is non-default', () => {
    expect(
      transformIsIdentity({
        quarterTurns: 1,
        fineAngleDeg: 0,
        crop: null,
      }),
    ).toBe(false);
    expect(
      transformIsIdentity({
        quarterTurns: 0,
        fineAngleDeg: 5,
        crop: null,
      }),
    ).toBe(false);
    expect(
      transformIsIdentity({
        quarterTurns: 0,
        fineAngleDeg: 0,
        crop: { x: 1, y: 1, w: 50, h: 50 },
      }),
    ).toBe(false);
  });
});
