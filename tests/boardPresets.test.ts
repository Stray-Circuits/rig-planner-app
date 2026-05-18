import { describe, expect, it } from 'vitest';
import {
  BOARD_PRESETS,
  findPreset,
  presetsByBrand,
} from '../src/data/boardPresets';

describe('boardPresets', () => {
  it('includes the six init-prompt presets', () => {
    expect(BOARD_PRESETS).toHaveLength(6);
    const names = BOARD_PRESETS.map((p) => `${p.brand} ${p.name}`);
    expect(names).toContain('Pedaltrain Nano+');
    expect(names).toContain('Pedaltrain Classic Pro');
    expect(names).toContain('Temple Audio Trio 21');
  });

  it('findPreset returns by id', () => {
    expect(findPreset('pedaltrain-nano-plus')?.name).toBe('Nano+');
    expect(findPreset('does-not-exist')).toBeUndefined();
  });

  it('presetsByBrand groups by brand', () => {
    const byBrand = presetsByBrand();
    expect(byBrand.get('Pedaltrain')).toHaveLength(3);
    expect(byBrand.get('Temple Audio')).toHaveLength(3);
  });
});
