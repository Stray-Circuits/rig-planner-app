import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTERNAL_IO, endpointsForConfig } from '../src/lib/externalIo';

describe('endpointsForConfig', () => {
  it('default config produces one Guitar + one Amp', () => {
    expect(endpointsForConfig(DEFAULT_EXTERNAL_IO)).toEqual([
      { kind: 'guitar', label: 'Guitar' },
      { kind: 'amp_in', label: 'Amp' },
    ]);
  });

  it('numbers multiple guitars and labels them Guitar 1 / Guitar 2', () => {
    const r = endpointsForConfig({ ...DEFAULT_EXTERNAL_IO, guitarCount: 2 });
    expect(r.filter((e) => e.kind === 'guitar').map((e) => e.label)).toEqual([
      'Guitar 1',
      'Guitar 2',
    ]);
  });

  it('stereo TRS amp is one endpoint; dual mono is two', () => {
    const trs = endpointsForConfig({
      ...DEFAULT_EXTERNAL_IO,
      ampMode: 'stereo_trs',
    });
    expect(trs.filter((e) => e.kind === 'amp_in')).toEqual([
      { kind: 'amp_in', label: 'Amp (TRS stereo)' },
    ]);
    const dual = endpointsForConfig({
      ...DEFAULT_EXTERNAL_IO,
      ampMode: 'dual_mono',
    });
    expect(dual.filter((e) => e.kind === 'amp_in').map((e) => e.label)).toEqual(
      ['Amp L', 'Amp R'],
    );
  });

  it('FX loop toggle adds send + return endpoints', () => {
    const r = endpointsForConfig({
      ...DEFAULT_EXTERNAL_IO,
      ampHasFxLoop: true,
    });
    expect(r.map((e) => e.kind)).toContain('amp_fx_send');
    expect(r.map((e) => e.kind)).toContain('amp_fx_return');
  });
});
