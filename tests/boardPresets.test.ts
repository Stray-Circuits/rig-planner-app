import { describe, expect, it } from 'vitest';
import {
  BOARD_PRESETS,
  BOARD_SERIES_ORDER,
  findPreset,
  pedaltrainPresetsBySeries,
  presetsByBrand,
} from '../src/data/boardPresets';

describe('boardPresets', () => {
  it('includes the full Pedaltrain lineup plus Temple Audio', () => {
    const names = BOARD_PRESETS.map((p) => `${p.brand} ${p.name}`);
    // Pedaltrain — 19 boards
    expect(names).toContain('Pedaltrain Nano');
    expect(names).toContain('Pedaltrain Nano+');
    expect(names).toContain('Pedaltrain Nano MAX');
    expect(names).toContain('Pedaltrain Metro 16');
    expect(names).toContain('Pedaltrain Metro MAX');
    expect(names).toContain('Pedaltrain Classic 1');
    expect(names).toContain('Pedaltrain Classic Pro');
    expect(names).toContain('Pedaltrain JR MAX');
    expect(names).toContain('Pedaltrain Novo 32');
    expect(names).toContain('Pedaltrain Terra 42');
    expect(names).toContain('Pedaltrain XD-18');
    expect(names).toContain('Pedaltrain XD-24');
    // Temple Audio — 3 boards (unchanged)
    expect(names).toContain('Temple Audio Solo 18');
    expect(names).toContain('Temple Audio Trio 21');
  });

  it('every Pedaltrain preset has a bundled image and a series', () => {
    const pedaltrains = BOARD_PRESETS.filter((p) => p.brand === 'Pedaltrain');
    expect(pedaltrains).toHaveLength(19);
    for (const p of pedaltrains) {
      expect(p.image, `${p.name} missing image`).toBeTruthy();
      expect(p.series, `${p.name} missing series`).toBeTruthy();
    }
  });

  it('Temple Audio presets stay procedural (no image)', () => {
    const temples = BOARD_PRESETS.filter((p) => p.brand === 'Temple Audio');
    expect(temples).toHaveLength(3);
    for (const p of temples) {
      expect(p.image).toBeUndefined();
    }
  });

  it('findPreset returns by id', () => {
    expect(findPreset('pedaltrain-nano-plus')?.name).toBe('Nano+');
    expect(findPreset('pedaltrain-xd-18')?.name).toBe('XD-18');
    expect(findPreset('does-not-exist')).toBeUndefined();
  });

  it('presetsByBrand groups by brand', () => {
    const byBrand = presetsByBrand();
    expect(byBrand.get('Pedaltrain')).toHaveLength(19);
    expect(byBrand.get('Temple Audio')).toHaveLength(3);
  });

  it('pedaltrainPresetsBySeries groups all 19 Pedaltrains across the five series', () => {
    const bySeries = pedaltrainPresetsBySeries();
    expect(Array.from(bySeries.keys())).toEqual([...BOARD_SERIES_ORDER]);
    expect(bySeries.get('Nano')).toHaveLength(3);
    expect(bySeries.get('Metro')).toHaveLength(4);
    expect(bySeries.get('Classic')).toHaveLength(6);
    expect(bySeries.get('Novo')).toHaveLength(3);
    expect(bySeries.get('Large')).toHaveLength(3);
    const total = Array.from(bySeries.values()).reduce(
      (n, list) => n + list.length,
      0,
    );
    expect(total).toBe(19);
  });

  it('all preset ids are unique', () => {
    const ids = BOARD_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all Pedaltrain (widthIn, depthIn) pairs are unique (so fuzzy match by dims is unambiguous)', () => {
    const keys = BOARD_PRESETS.filter((p) => p.brand === 'Pedaltrain').map(
      (p) => `${p.widthIn}x${p.depthIn}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
