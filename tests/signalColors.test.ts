import { describe, expect, it } from 'vitest';
import { colorForPort, colorForSignal } from '../src/lib/signalColors';
import type { Port } from '../src/data/schema';

function fx(
  role: 'fx_send' | 'fx_return',
  label: string,
): Pick<Port, 'role' | 'signalType' | 'label'> {
  return { role, signalType: 'instrument', label };
}

describe('colorForPort — FX loops (#124)', () => {
  it('uses the same color for both ports of a loop', () => {
    expect(colorForPort(fx('fx_send', 'FX Send 1'))).toBe(
      colorForPort(fx('fx_return', 'FX Return 1')),
    );
    expect(colorForPort(fx('fx_send', 'FX Send 2'))).toBe(
      colorForPort(fx('fx_return', 'FX Return 2')),
    );
  });

  it('gives different loops different colors', () => {
    expect(colorForPort(fx('fx_send', 'FX Send 1'))).not.toBe(
      colorForPort(fx('fx_send', 'FX Send 2')),
    );
  });

  it('treats a bare (single) loop as loop 1 = instrument green', () => {
    expect(colorForPort(fx('fx_send', 'FX Send'))).toBe(
      colorForSignal('instrument'),
    );
    expect(colorForPort(fx('fx_send', 'FX Send'))).toBe(
      colorForPort(fx('fx_send', 'FX Send 1')),
    );
  });

  it('wraps around when there are more loops than palette colors', () => {
    // Palette has 4 entries; loop 5 wraps back to loop 1.
    expect(colorForPort(fx('fx_send', 'FX Send 5'))).toBe(
      colorForPort(fx('fx_send', 'FX Send 1')),
    );
  });
});
