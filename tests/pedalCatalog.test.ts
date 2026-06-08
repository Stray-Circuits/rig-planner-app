import { describe, expect, it } from 'vitest';
import { PEDAL_CATALOG, findPedalInCatalog } from '../src/data/pedalCatalog';

const MIN_INCHES = 0.5;
const MAX_INCHES = 24;

describe('PEDAL_CATALOG — per-row sanity', () => {
  it('every row has a non-empty brand and name', () => {
    for (const e of PEDAL_CATALOG) {
      expect(e.brand.trim().length, `brand for ${e.name}`).toBeGreaterThan(0);
      expect(e.name.trim().length, `name in ${e.brand}`).toBeGreaterThan(0);
    }
  });

  it('every widthIn / depthIn is within pedal sanity range', () => {
    for (const e of PEDAL_CATALOG) {
      const label = `${e.brand} ${e.name}`;
      expect(Number.isFinite(e.widthIn), `${label} widthIn finite`).toBe(true);
      expect(Number.isFinite(e.depthIn), `${label} depthIn finite`).toBe(true);
      expect(e.widthIn, `${label} widthIn lower`).toBeGreaterThanOrEqual(
        MIN_INCHES,
      );
      expect(e.widthIn, `${label} widthIn upper`).toBeLessThanOrEqual(
        MAX_INCHES,
      );
      expect(e.depthIn, `${label} depthIn lower`).toBeGreaterThanOrEqual(
        MIN_INCHES,
      );
      expect(e.depthIn, `${label} depthIn upper`).toBeLessThanOrEqual(
        MAX_INCHES,
      );
    }
  });

  it('no duplicate (brand, name) rows', () => {
    const seen = new Set<string>();
    for (const e of PEDAL_CATALOG) {
      const key = `${e.brand.toLowerCase()}::${e.name.toLowerCase()}`;
      expect(seen.has(key), `duplicate entry: ${e.brand} / ${e.name}`).toBe(
        false,
      );
      seen.add(key);
    }
  });
});

describe('findPedalInCatalog', () => {
  it('returns null when brand or name is missing', () => {
    expect(findPedalInCatalog(null, 'DS-1')).toBeNull();
    expect(findPedalInCatalog('Boss', null)).toBeNull();
    expect(findPedalInCatalog('', '')).toBeNull();
  });

  it('matches a canonical entry exactly', () => {
    const hit = findPedalInCatalog('Boss', 'DS-1');
    expect(hit?.widthIn).toBe(2.87);
    expect(hit?.depthIn).toBe(5.08);
  });

  it('matches a typed alias', () => {
    const hit = findPedalInCatalog('Boss', 'DS1');
    expect(hit?.name).toBe('DS-1');
  });

  it('is case-insensitive', () => {
    const hit = findPedalInCatalog('boss', 'ds-1');
    expect(hit?.name).toBe('DS-1');
  });

  it('handles punctuation differences (DS-1 ↔ DS 1)', () => {
    expect(findPedalInCatalog('Boss', 'DS 1')?.name).toBe('DS-1');
    expect(findPedalInCatalog('Boss', 'ds 1')?.name).toBe('DS-1');
  });

  it('accepts longer typed names that contain the canonical model', () => {
    // User typed the full marketing name; catalog row is just the model.
    const hit = findPedalInCatalog('Boss', 'DS-1 Distortion');
    expect(hit?.name).toBe('DS-1');
  });

  it('matches brand fuzzily ("JHS" ↔ "JHS Pedals")', () => {
    // Catalog has "JHS Pedals"; user typed plain "JHS".
    expect(findPedalInCatalog('JHS', 'Morning Glory')?.name).toBe(
      'Morning Glory',
    );
    // Inverse: typed the catalog form when wandering in via the wizard.
    expect(findPedalInCatalog('JHS Pedals', 'Morning Glory')?.name).toBe(
      'Morning Glory',
    );
  });

  it('returns null when the brand is unknown', () => {
    expect(findPedalInCatalog('NoSuchBrand', 'DS-1')).toBeNull();
  });

  it('returns null when the name does not match any catalog row for the brand', () => {
    expect(findPedalInCatalog('Boss', 'NotAModel')).toBeNull();
  });

  it('does NOT cross-match a name from a different brand', () => {
    // The catalog has Boss "DS-1" — typing a Boss model under another
    // brand must not return the Boss row.
    expect(findPedalInCatalog('MXR', 'DS-1')).toBeNull();
  });

  it('prefers the longer / more specific canonical name on tie', () => {
    // Both "Belle Epoch" and "Belle Epoch Deluxe" match "Belle Epoch
    // Deluxe Tape Echo"; the deluxe row wins.
    const hit = findPedalInCatalog(
      'Catalinbread',
      'Belle Epoch Deluxe Tape Echo',
    );
    expect(hit?.name).toBe('Belle Epoch Deluxe');
  });

  it('strips trademark symbols when matching', () => {
    const hit = findPedalInCatalog('MXR', 'Phase 90®');
    expect(hit?.name).toBe('Phase 90');
  });

  // ---- B's Music Shop cat-art editions ----

  it("matches a Keeley B's Music Shop cat edition by its cat name", () => {
    // Catverns inherits Keeley Caverns V2's PP dim (3.7 × 4.9).
    const hit = findPedalInCatalog('Keeley', 'Catverns');
    expect(hit?.name).toBe('Catverns');
    expect(hit?.widthIn).toBe(3.7);
    expect(hit?.depthIn).toBe(4.9);
  });

  it("falls back to a cat edition's base-pedal alias", () => {
    const hit = findPedalInCatalog('Keeley', 'Mews Driver');
    expect(hit?.name).toBe('Mews Driver');
  });

  it('matches OBNE cat editions under their full brand', () => {
    // Purr-ting inherits OBNE Parting's PP dim (4.25 × 4.84).
    const hit = findPedalInCatalog('Old Blood Noise Endeavors', 'Purr-ting');
    expect(hit?.widthIn).toBe(4.25);
    expect(hit?.depthIn).toBe(4.84);
  });

  it('matches OBNE Purrcession with the Procession dim from PP', () => {
    const hit = findPedalInCatalog('Old Blood Noise Endeavors', 'Purrcession');
    expect(hit?.widthIn).toBe(2.87);
    expect(hit?.depthIn).toBe(4.96);
  });

  it('matches Alexander Pedals cat editions with the Marshmallow-class dim', () => {
    const hit = findPedalInCatalog('Alexander Pedals', 'Ninja Cat');
    expect(hit?.widthIn).toBe(2.89);
    expect(hit?.depthIn).toBe(4.88);
  });

  it("matches Supercool's Barstow Cat with the Barstow Bat base dim", () => {
    const hit = findPedalInCatalog('Supercool Pedals', 'The Barstow Cat');
    expect(hit?.widthIn).toBe(4.01);
    expect(hit?.depthIn).toBe(4.79);
  });
});
