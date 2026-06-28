import { describe, expect, it } from 'vitest';
import { renumberFxLoops } from '../src/screens/add-pedal/portReorder';
import type { DraftPort } from '../src/screens/add-pedal/portReorder';
import type { PortRole } from '../src/data/schema';

let seq = 0;
function port(role: PortRole, label: string): DraftPort {
  seq += 1;
  return {
    label,
    role,
    signalType: 'instrument',
    connector: 'ts',
    side: 'top',
    sideOrder: seq,
    optional: true,
    _draftId: `t-${seq}`,
  };
}

describe('renumberFxLoops', () => {
  it('leaves a lone FX loop unnumbered', () => {
    const out = renumberFxLoops([
      port('input', 'In'),
      port('fx_send', 'FX Send'),
      port('fx_return', 'FX Return'),
    ]);
    expect(out.map((p) => p.label)).toEqual(['In', 'FX Send', 'FX Return']);
  });

  it('numbers multiple loops by occurrence order, per role', () => {
    const out = renumberFxLoops([
      port('fx_send', 'FX Send'),
      port('fx_return', 'FX Return'),
      port('fx_send', 'FX Send'),
      port('fx_return', 'FX Return'),
    ]);
    expect(out.map((p) => p.label)).toEqual([
      'FX Send 1',
      'FX Return 1',
      'FX Send 2',
      'FX Return 2',
    ]);
  });

  it('drops the number again when a loop is removed back to one', () => {
    const two = renumberFxLoops([
      port('fx_send', 'FX Send'),
      port('fx_send', 'FX Send'),
    ]);
    expect(two.map((p) => p.label)).toEqual(['FX Send 1', 'FX Send 2']);
    const one = renumberFxLoops([two[0]!]);
    expect(one.map((p) => p.label)).toEqual(['FX Send']);
  });

  it('leaves non-FX ports untouched and preserves identity of unchanged ports', () => {
    const input = [port('input', 'In'), port('output', 'Out')];
    const out = renumberFxLoops(input);
    expect(out[0]).toBe(input[0]);
    expect(out[1]).toBe(input[1]);
  });
});
