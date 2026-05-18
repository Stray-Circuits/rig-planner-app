import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no real Canvas2D; stub getContext so BoardThumb's effect
// doesn't trigger the "not implemented" logger. Tests that want to
// exercise drawing should use the fake-context pattern in boardStyles.test.ts.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
}

afterEach(() => {
  cleanup();
});
