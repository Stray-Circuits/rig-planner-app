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

  it('rejects matches where the user named a variant the catalog row lacks (#73 round 12)', () => {
    // 'PolyTune 3' has an alias 'PolyTune'. Without the variant guard,
    // typing "polytune deluxe" would match because catalog [polytune]
    // is a subset of user [polytune, deluxe]. But the qualifier
    // mismatch (catalog lacks "deluxe") is evidence of a different
    // product — reject.
    expect(
      findPedalInCatalog('TC Electronic', 'Hall of Fame Deluxe'),
    ).toBeNull();
    // The qualifier check is one-directional — `catalog ⊆ user` ALSO
    // requires every catalog token to be present in user input, so a
    // catalog row "Compressor Mini" already requires the user to type
    // "mini". The new check guards the *other* direction.
    expect(findPedalInCatalog('Keeley', 'Compressor Mini')?.name).toBe(
      'Compressor Mini',
    );
    expect(findPedalInCatalog('Keeley', 'Compressor Plus')?.name).toBe(
      'Compressor Plus',
    );
    // Sanity: a clean exact-or-superset match still works.
    expect(findPedalInCatalog('TC Electronic', 'PolyTune 3')?.name).toBe(
      'PolyTune 3',
    );
    expect(findPedalInCatalog('TC Electronic', 'PolyTune')?.name).toBe(
      'PolyTune 3',
    );
  });

  it('matches the explicit PolyTune Mini / Mini Noir rows (#73 round 13)', () => {
    // Added because round-9 PP adoption left these out and they're
    // very popular — round-12's qualifier guard would otherwise reject
    // "polytune mini" as a false positive.
    const mini = findPedalInCatalog('TC Electronic', 'PolyTune Mini');
    expect(mini?.name).toBe('PolyTune Mini');
    expect(mini?.widthIn).toBe(2);
    expect(mini?.depthIn).toBe(3.75);
    expect(findPedalInCatalog('TC Electronic', 'PolyTune 3 Mini')?.name).toBe(
      'PolyTune Mini',
    );
    const noir = findPedalInCatalog('TC Electronic', 'PolyTune Mini Noir');
    expect(noir?.name).toBe('PolyTune Mini Noir');
    expect(noir?.widthIn).toBe(2);
    expect(noir?.depthIn).toBe(3.75);
  });

  it('falls back to a same-brand same-size-class entry when the exact pedal is missing (#73 round 13)', () => {
    // User types a TC Electronic Mini variant we don't carry (e.g.,
    // "Spark Mini"). The qualifier guard would reject every TC
    // Electronic row whose name lacks "mini". The size-class fallback
    // then offers up the first same-brand "Mini" row's dim — usually
    // safe because a brand's mini-class pedals share an enclosure.
    const sparkMini = findPedalInCatalog('TC Electronic', 'Spark Mini');
    expect(sparkMini?.widthIn).toBe(2);
    expect(sparkMini?.depthIn).toBe(3.75);
  });

  it('returns null when neither an exact match nor a same-class fallback exists', () => {
    // Boss doesn't make mini-format pedals (no Boss row with "mini" in
    // the canonical name), so a typed "Boss DS-1 Mini" can't even
    // fall back to a brand-class dim — return null so the user gets
    // no auto-fill and types the dims themselves.
    expect(findPedalInCatalog('Boss', 'DS-1 Mini')).toBeNull();
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
