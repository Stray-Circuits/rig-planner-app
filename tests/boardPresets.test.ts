import { describe, expect, it } from 'vitest';
import {
  BOARD_PRESETS,
  PEDALTRAIN_SERIES_ORDER,
  TEMPLE_AUDIO_SERIES_ORDER,
  findClosestRailPreset,
  findPreset,
  pedaltrainPresetsBySeries,
  presetsByBrand,
  resolveBoardImageSrc,
  templeAudioPresetsBySeries,
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
    // Temple Audio — full Solo/Duo/Trio lineup
    expect(names).toContain('Temple Audio Solo 18');
    expect(names).toContain('Temple Audio Duo 17');
    expect(names).toContain('Temple Audio Duo 24');
    expect(names).toContain('Temple Audio Duo 34');
    expect(names).toContain('Temple Audio Trio 21');
    expect(names).toContain('Temple Audio Trio 28');
    expect(names).toContain('Temple Audio Trio 43');
  });

  it('every Pedaltrain preset has a bundled image and a series', () => {
    const pedaltrains = BOARD_PRESETS.filter((p) => p.brand === 'Pedaltrain');
    expect(pedaltrains).toHaveLength(19);
    for (const p of pedaltrains) {
      expect(p.image, `${p.name} missing image`).toBeTruthy();
      expect(p.series, `${p.name} missing series`).toBeTruthy();
    }
  });

  it('Temple Audio presets stay procedural (no image) and carry a series', () => {
    const temples = BOARD_PRESETS.filter((p) => p.brand === 'Temple Audio');
    expect(temples).toHaveLength(7);
    for (const p of temples) {
      expect(p.image).toBeUndefined();
      expect(p.series, `${p.name} missing series`).toBeTruthy();
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
    expect(byBrand.get('Temple Audio')).toHaveLength(7);
  });

  it('pedaltrainPresetsBySeries groups all 19 Pedaltrains across the five series', () => {
    const bySeries = pedaltrainPresetsBySeries();
    expect(Array.from(bySeries.keys())).toEqual([...PEDALTRAIN_SERIES_ORDER]);
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

  it('templeAudioPresetsBySeries groups all 7 Temples across Solo/Duo/Trio', () => {
    const bySeries = templeAudioPresetsBySeries();
    expect(Array.from(bySeries.keys())).toEqual([...TEMPLE_AUDIO_SERIES_ORDER]);
    expect(bySeries.get('Solo')).toHaveLength(1);
    expect(bySeries.get('Duo')).toHaveLength(3);
    expect(bySeries.get('Trio')).toHaveLength(3);
    const total = Array.from(bySeries.values()).reduce(
      (n, list) => n + list.length,
      0,
    );
    expect(total).toBe(7);
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

describe('findClosestRailPreset', () => {
  it('returns the exact preset when dims match', () => {
    expect(findClosestRailPreset(32, 16)?.id).toBe('pedaltrain-classic-pro');
    expect(findClosestRailPreset(14, 5.5)?.id).toBe('pedaltrain-nano');
  });

  it('picks the nearest neighbor for in-between dims', () => {
    // 25x8 is closest to Metro 24 (24x8), distance = 1
    // Metro MAX (28x8) is distance 3, Classic 2 (24x12.5) is sqrt(1 + 20.25)
    expect(findClosestRailPreset(25, 8)?.id).toBe('pedaltrain-metro-24');
  });

  it('considers depth as well as width', () => {
    // 24-wide is shared by Metro 24, Classic 2, Classic 3, Novo 24, XD-24.
    // At depth 14.5 the closest is Novo 24.
    expect(findClosestRailPreset(24, 14.5)?.id).toBe('pedaltrain-novo-24');
  });

  it('skips Temple Audio (non-rail) and any preset without an image', () => {
    // Temple Solo 18 dims (16.7, 8.5) — a rail-style query nearby should
    // still pick a Pedaltrain, not Solo 18.
    const result = findClosestRailPreset(16.7, 8.5);
    expect(result?.brand).toBe('Pedaltrain');
  });
});

describe('resolveBoardImageSrc', () => {
  it('returns the preset image when presetId resolves', () => {
    const src = resolveBoardImageSrc({
      style: 'rail',
      presetId: 'pedaltrain-classic-pro',
      widthIn: 32,
      depthIn: 16,
    });
    expect(src).toBe(findPreset('pedaltrain-classic-pro')?.image);
  });

  it('falls back to closest rail render for custom rail rigs', () => {
    // Custom 26x8 → no preset matches → closest is Metro MAX (28x8) at dist 4
    // (Metro 24 (24x8) is also dist 4 — tiebreak by encounter order which
    // for our data is Metro 24 → Metro MAX, so Metro 24 wins on ties.)
    const src = resolveBoardImageSrc({
      style: 'rail',
      presetId: null,
      widthIn: 26,
      depthIn: 8,
    });
    expect(src).toBe(findPreset('pedaltrain-metro-24')?.image);
  });

  it('returns null for non-rail custom rigs (procedural fallback)', () => {
    expect(
      resolveBoardImageSrc({
        style: 'plain',
        presetId: null,
        widthIn: 20,
        depthIn: 10,
      }),
    ).toBeNull();
    expect(
      resolveBoardImageSrc({
        style: 'wood',
        presetId: null,
        widthIn: 20,
        depthIn: 10,
      }),
    ).toBeNull();
    expect(
      resolveBoardImageSrc({
        style: 'holes',
        presetId: null,
        widthIn: 20,
        depthIn: 10,
      }),
    ).toBeNull();
  });

  it('returns null for Temple Audio presets (no image yet)', () => {
    const src = resolveBoardImageSrc({
      style: 'holes',
      presetId: 'temple-duo-24',
      widthIn: 23.2,
      depthIn: 12.5,
    });
    expect(src).toBeNull();
  });
});
