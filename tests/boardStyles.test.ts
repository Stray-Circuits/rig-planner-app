import { describe, expect, it } from 'vitest';
import {
  BOARD_DRAWERS,
  backgroundForStyle,
  drawHoles,
  drawPlain,
  drawRail,
  drawWood,
} from '../src/canvas/boardStyles';

/**
 * jsdom has no real Canvas2D — getContext returns null. We exercise the
 * drawers against a hand-rolled fake context that records calls, so we can
 * still assert "doesn't throw at multiple scales" without bundling a heavy
 * canvas polyfill.
 */
function fakeCtx(): CanvasRenderingContext2D {
  const noop = () => undefined;
  // Minimal subset of the methods/props the drawers use.
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    stroke: noop,
    fill: noop,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

describe('boardStyles', () => {
  it('has a drawer registered for each style', () => {
    expect(Object.keys(BOARD_DRAWERS).sort()).toEqual([
      'holes',
      'plain',
      'rail',
      'wood',
    ]);
  });

  it('rail uses a transparent-friendly grey backdrop', () => {
    expect(backgroundForStyle('rail')).toBe('#888');
    expect(backgroundForStyle('plain')).toBe('transparent');
  });

  it('drawers run without throwing at multiple scales', () => {
    const ctx = fakeCtx();
    expect(() =>
      drawRail({ ctx, width: 120, height: 60, scale: 1 }),
    ).not.toThrow();
    expect(() =>
      drawPlain({ ctx, width: 120, height: 60, scale: 0.2 }),
    ).not.toThrow();
    expect(() =>
      drawPlain({ ctx, width: 500, height: 200, scale: 1 }),
    ).not.toThrow();
    expect(() =>
      drawWood({ ctx, width: 120, height: 60, scale: 1 }),
    ).not.toThrow();
    expect(() =>
      drawHoles({ ctx, width: 120, height: 60, scale: 0.2 }),
    ).not.toThrow();
  });
});
