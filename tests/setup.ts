import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no real Canvas2D; stub getContext so BoardThumb's effect
// doesn't trigger the "not implemented" logger. Tests that want to
// exercise drawing should use the fake-context pattern in boardStyles.test.ts.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
}

// jsdom also lacks ResizeObserver, which the canvas-area uses for fit-to-view.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class FakeResizeObserver {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  };
}

// @imgly/background-removal loads a 176MB ONNX model + WebGPU/WASM runtime;
// none of that works in jsdom. Replace it with a stub that pretends to do
// the work and returns the same Blob unchanged. Real exercise of bg removal
// happens via manual / device testing.
vi.mock('@imgly/background-removal', () => ({
  removeBackground: vi.fn((input: Blob) => Promise.resolve(input)),
}));

afterEach(() => {
  cleanup();
});
