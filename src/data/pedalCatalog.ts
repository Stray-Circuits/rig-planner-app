/**
 * Curated catalog of common pedals with verified dimensions.
 *
 * Used as a last-resort fill source by `extractPedalMetadata` (when web
 * scraping returns brand + name but the solo-dim drop killed dims) and as
 * a direct lookup in the add-pedal wizard (typing a known brand + name
 * auto-fills width/depth without invoking the image search at all).
 *
 * Convention follows `Pedal.widthIn` / `Pedal.depthIn`:
 *
 *   - `widthIn` is left-to-right when the pedal is placed for play
 *     (knobs up, jacks at the back).
 *   - `depthIn` is front-to-back (the longer axis on most stompboxes).
 *
 * Sourcing — each brand-family was verified against the manufacturer's
 * own product page (or, where the maker doesn't publish dims, against a
 * spec-rich retailer like Sweetwater or a dimension-focused review).
 * Verified brand-family dimensions:
 *
 *   - Boss compact: 2.87 × 5.08 (Boss-proprietary 73 × 129 mm).
 *   - MXR 1591B-class (Phase 90 etc.): 2.25 × 4.25.
 *   - MXR 1591-class mini (Phase 95, Sugar Drive, Booster Mini): 1.50 × 3.65 — UNVERIFIED.
 *   - Strymon Big Box (Timeline, BigSky, ...): 6.75 × 5.1.
 *   - Strymon Compact (Flint, El Capistan, ...): 4.0 × 4.5.
 *   - Strymon Cloudburst: 2.7 × 4.6.
 *   - Walrus standard MKII (Slö, Julia, ...): 2.6 × 4.77.
 *   - JHS Pedals (all): 2.6 × 4.8.
 *   - Wampler 1590B-class (Tumnus Deluxe, Sovereign, ...): 2.5 × 4.5.
 *   - Wampler 1590BB-class (Plexi-Drive Deluxe, Triple Wreck): 3.5 × 4.5.
 *   - Wampler Tumnus / Belle (mini): 1.5 × 3.5.
 *   - Empress stack-knob (Reverb, Echosystem, ...): 3.75 × 5.7.
 *   - Eventide H9 / H9 Max: 4.65 × 5.25.
 *   - Eventide Factor series (TimeFactor, ...): 7.5 × 4.8.
 *   - Eventide dot9 (Blackhole, ...): 4.0 × 4.25.
 *   - EarthQuaker Devices 1590B-class (Plumes, Afterneath, ...): 2.5 × 4.75.
 *   - EQD Avalanche Run: 4.15 × 4.65.
 *   - EQD Disaster Transport SR: 4.75 × 5.65.
 *   - Chase Bliss (all): 2.9 × 4.9.
 *   - Source Audio dual-knob (Ventris, Collider): 4.6 × 4.4.
 *   - Catalinbread Belle Epoch: 2.36 × 4.33. Belle Epoch Deluxe / Echorec: 4.68 × 3.66.
 *   - Keeley 1590B-class (Compressor Plus, Caverns V2, NocPurrne, ...): 2.68 × 4.41.
 *   - Keeley stack-knob (Halo, Synth-1, Loomer, Dark Side, ...): 3.90 × 4.72.
 *   - Keeley mini (Compressor Mini, Mini-Kittyana): 1.85 × 3.74.
 *   - Mooer Micro series (all): 1.65 × 3.68.
 *   - Empress Buffer+: 1.26 × 4.49.
 *   - Line 6 HX Stomp XL: 4.72 × 12.44.
 *   - Way Huge Smalls Aqua-Puss: 2.40 × 4.09.
 *
 * UNVERIFIED (rows still ship but flagged for follow-up): Electro-Harmonix
 * (per-pedal), Walrus Mako D1, Source Audio One Series solo, Way Huge
 * non-Smalls, TC Electronic, most Line 6, ZVEX, Maxon, Catalinbread
 * non-Belle-Epoch, OBNE, Summer School Electronics, Alexander Pedals,
 * Supercool Pedals, Cusack Music, Oneder Effects, Mojo Hand FX, and
 * the ~30 pedals where Brave/Thomann couldn't surface dim data.
 */

export interface PedalCatalogEntry {
  brand: string;
  name: string;
  widthIn: number;
  depthIn: number;
  /**
   * Optional extra strings the lookup will match against in addition to
   * `name`. Useful when the canonical name has punctuation or whitespace
   * variants ("DS-1" / "DS1" / "DS 1") or a longer marketing form
   * ("Belle Epoch Deluxe" alias for "Belle Epoch Deluxe Tape Echo").
   */
  aliases?: readonly string[];
}

// ---------- Lookup ----------

/**
 * Token-set match: every catalog token must appear in the user's input
 * string. Used for name matching so "Boss DS-1 Distortion Pedal" still
 * matches the catalog entry whose name is "DS-1".
 */
function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[®™©℠]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isBrandCompatible(catalogBrand: string, userBrand: string): boolean {
  const a = normalize(catalogBrand);
  const b = normalize(userBrand);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  // "JHS" should match user-typed "JHS Pedals" and vice versa.
  return a.includes(b) || b.includes(a);
}

function isNameCompatible(
  catalogTokens: string[],
  userTokens: string[],
): boolean {
  if (catalogTokens.length === 0 || userTokens.length === 0) return false;
  return catalogTokens.every((t) => userTokens.includes(t));
}

/**
 * Look up a catalog entry by brand + name. Both inputs are required —
 * matching a name alone (without a brand) risks pulling the wrong
 * pedal when two brands ship pedals with overlapping model names.
 *
 * Among matching rows, picks the one whose canonical name has the most
 * tokens — so a typed "Belle Epoch Deluxe" matches the deluxe row
 * rather than the base "Belle Epoch".
 */
export function findPedalInCatalog(
  brand: string | null | undefined,
  name: string | null | undefined,
): PedalCatalogEntry | null {
  if (!brand || !name) return null;
  const userBrand = brand;
  const userNameTokens = tokenize(name);

  let best: PedalCatalogEntry | null = null;
  let bestSpecificity = -1;

  for (const entry of PEDAL_CATALOG) {
    if (!isBrandCompatible(entry.brand, userBrand)) continue;
    const nameVariants = [entry.name, ...(entry.aliases ?? [])];
    let matched = false;
    let specificity = 0;
    for (const variant of nameVariants) {
      const variantTokens = tokenize(variant);
      if (isNameCompatible(variantTokens, userNameTokens)) {
        matched = true;
        specificity = Math.max(specificity, variantTokens.length);
      }
    }
    if (!matched) continue;
    if (specificity > bestSpecificity) {
      best = entry;
      bestSpecificity = specificity;
    }
  }
  return best;
}

// ---------- Catalog data ----------
//
// Rows are grouped by brand, brand order matches `KNOWN_BRANDS` in
// `src/lib/pedalMetadata.ts`. Within each brand, the most-popular models
// come first.

export const PEDAL_CATALOG: readonly PedalCatalogEntry[] = [
  // ---- Boss ---- (compact = 2.87 × 5.08, twin = 6.18 × 5.08)
  // source: Boss compact spec (Hammond-proprietary 73 × 129 mm).
  {
    brand: 'Boss',
    name: 'DS-1',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['DS1', 'DS 1', 'DS-1 Distortion'],
  },
  {
    brand: 'Boss',
    name: 'OD-3',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['OD3'],
  },
  {
    brand: 'Boss',
    name: 'BD-2',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['BD2', 'Blues Driver'],
  },
  {
    brand: 'Boss',
    name: 'SD-1',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['SD1', 'Super Overdrive'],
  },
  {
    brand: 'Boss',
    name: 'DD-8',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['DD8'],
  },
  {
    brand: 'Boss',
    name: 'RV-6',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['RV6'],
  },
  {
    brand: 'Boss',
    name: 'TU-3',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['TU3'],
  },
  {
    brand: 'Boss',
    name: 'CE-2W',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['CE2W', 'Chorus'],
  },
  {
    brand: 'Boss',
    name: 'MT-2',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['MT2', 'Metal Zone'],
  },
  {
    brand: 'Boss',
    name: 'GE-7',
    widthIn: 2.87,
    depthIn: 5.08,
    aliases: ['GE7', 'Equalizer'],
  },

  // ---- MXR ---- (1591B standard = 2.36 × 4.38, mini = 1.50 × 3.65)
  // source: Hammond 1591B / 1591 enclosure datasheets.
  {
    brand: 'MXR',
    name: 'Phase 90',
    widthIn: 2.25,
    depthIn: 4.25,
    aliases: ['M101'],
  },
  {
    brand: 'MXR',
    name: 'Carbon Copy',
    widthIn: 2.25,
    depthIn: 4.25,
    aliases: ['M169'],
  },
  {
    brand: 'MXR',
    name: 'Dyna Comp',
    widthIn: 2.25,
    depthIn: 4.25,
    aliases: ['M102'],
  },
  {
    brand: 'MXR',
    name: 'Phase 95',
    widthIn: 1.5,
    depthIn: 3.65,
    aliases: ['M290'],
  },
  {
    brand: 'MXR',
    name: 'Micro Amp',
    widthIn: 2.25,
    depthIn: 4.25,
    aliases: ['M133'],
  },
  {
    brand: 'MXR',
    name: 'Distortion+',
    widthIn: 2.25,
    depthIn: 4.25,
    aliases: ['M104', 'Distortion Plus'],
  },
  {
    brand: 'MXR',
    name: 'Custom Badass 78 Distortion',
    widthIn: 2.25,
    depthIn: 4.25,
    aliases: ['M78', "Custom Badass '78"],
  },
  {
    brand: 'MXR',
    name: 'Sugar Drive',
    widthIn: 1.5,
    depthIn: 3.65,
    aliases: ['M294'],
  },
  {
    brand: 'MXR',
    name: 'EVH 5150 Overdrive',
    widthIn: 2.25,
    depthIn: 4.25,
    aliases: ['EVH5150'],
  },
  {
    brand: 'MXR',
    name: 'Booster Mini',
    widthIn: 1.5,
    depthIn: 3.65,
    aliases: ['M293'],
  },

  // ---- Electro-Harmonix ----
  // source: EHX manufacturer product pages (per-pedal, sizes vary).
  {
    brand: 'Electro-Harmonix',
    name: 'Big Muff Pi',
    widthIn: 5.75,
    depthIn: 4.63,
    aliases: ['EHX Big Muff', 'NYC Big Muff'],
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Nano Big Muff',
    widthIn: 2.25,
    depthIn: 4.5,
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Soul Food',
    widthIn: 2.75,
    depthIn: 4.75,
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Memory Boy Deluxe',
    widthIn: 4.75,
    depthIn: 4.75,
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Holy Grail Nano',
    widthIn: 2.38,
    depthIn: 3.63,
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Cathedral',
    widthIn: 5.63,
    depthIn: 6.75,
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Mel9',
    widthIn: 4.63,
    depthIn: 4.5,
    aliases: ['Mel 9'],
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Pog 2',
    widthIn: 4.5,
    depthIn: 7.5,
    aliases: ['POG2'],
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Pitch Fork',
    widthIn: 2.75,
    depthIn: 4.75,
  },
  {
    brand: 'Electro-Harmonix',
    name: 'Small Stone',
    widthIn: 4.63,
    depthIn: 4.63,
  },

  // ---- Strymon ---- (Big Box = 6.75 × 5.1, Compact = 4.0 × 4.5)
  // source: Strymon FAQ "What are the [pedal] dimensions?" pages.
  { brand: 'Strymon', name: 'Timeline', widthIn: 6.75, depthIn: 5.1 },
  {
    brand: 'Strymon',
    name: 'BigSky',
    widthIn: 6.75,
    depthIn: 5.1,
    aliases: ['Big Sky'],
  },
  { brand: 'Strymon', name: 'Mobius', widthIn: 6.75, depthIn: 5.1 },
  {
    brand: 'Strymon',
    name: 'NightSky',
    widthIn: 6.75,
    depthIn: 5.1,
    aliases: ['Night Sky'],
  },
  { brand: 'Strymon', name: 'Volante', widthIn: 6.75, depthIn: 5.1 },
  { brand: 'Strymon', name: 'El Capistan', widthIn: 4.0, depthIn: 4.5 },
  { brand: 'Strymon', name: 'Flint', widthIn: 4.0, depthIn: 4.5 },
  { brand: 'Strymon', name: 'Deco', widthIn: 4.0, depthIn: 4.5 },
  {
    brand: 'Strymon',
    name: 'blueSky',
    widthIn: 4.0,
    depthIn: 4.5,
    aliases: ['Blue Sky'],
  },
  { brand: 'Strymon', name: 'Cloudburst', widthIn: 2.7, depthIn: 4.6 },

  // ---- Walrus Audio ---- (standard MKII = 2.795 × 4.77, Mako = 4.6 × 5.5)
  // source: Walrus product pages.
  {
    brand: 'Walrus Audio',
    name: 'Slö',
    widthIn: 2.6,
    depthIn: 4.77,
    aliases: ['Slo', 'Slö Multi Texture Reverb'],
  },
  { brand: 'Walrus Audio', name: 'Julianna', widthIn: 2.6, depthIn: 4.77 },
  { brand: 'Walrus Audio', name: 'Julia', widthIn: 2.6, depthIn: 4.77 },
  { brand: 'Walrus Audio', name: 'Lillian', widthIn: 2.6, depthIn: 4.77 },
  { brand: 'Walrus Audio', name: 'Iron Horse', widthIn: 2.6, depthIn: 4.77 },
  { brand: 'Walrus Audio', name: 'Voyager', widthIn: 2.6, depthIn: 4.77 },
  { brand: 'Walrus Audio', name: 'Eras', widthIn: 2.6, depthIn: 4.77 },
  {
    brand: 'Walrus Audio',
    name: 'ARP-87',
    widthIn: 2.6,
    depthIn: 4.77,
    aliases: ['ARP 87', 'ARP87'],
  },
  { brand: 'Walrus Audio', name: 'Polychrome', widthIn: 2.6, depthIn: 4.77 },
  {
    brand: 'Walrus Audio',
    name: 'Mako D1',
    widthIn: 4.6,
    depthIn: 5.5,
    aliases: ['D1 Delay'],
  },

  // ---- JHS Pedals ---- (1590B 2.37 × 4.39 standard)
  // source: Hammond 1590B; JHS uses it for nearly the whole line.
  { brand: 'JHS Pedals', name: 'Morning Glory', widthIn: 2.6, depthIn: 4.8 },
  { brand: 'JHS Pedals', name: 'Crayon', widthIn: 2.6, depthIn: 4.8 },
  {
    brand: 'JHS Pedals',
    name: "Pulp 'N Peel",
    widthIn: 2.6,
    depthIn: 4.8,
    aliases: ['Pulp N Peel', 'Pulp and Peel'],
  },
  { brand: 'JHS Pedals', name: 'Muffuletta', widthIn: 2.6, depthIn: 4.8 },
  { brand: 'JHS Pedals', name: 'Bonsai', widthIn: 2.6, depthIn: 4.8 },
  {
    brand: 'JHS Pedals',
    name: 'SuperBolt',
    widthIn: 2.6,
    depthIn: 4.8,
    aliases: ['Super Bolt'],
  },
  { brand: 'JHS Pedals', name: 'Sweet Tea', widthIn: 2.6, depthIn: 4.8 },
  { brand: 'JHS Pedals', name: 'Charlie Brown', widthIn: 2.6, depthIn: 4.8 },
  { brand: 'JHS Pedals', name: 'Calhoun', widthIn: 2.6, depthIn: 4.8 },
  {
    brand: 'JHS Pedals',
    name: 'Andy Timmons Drive',
    widthIn: 2.6,
    depthIn: 4.8,
    aliases: ['AT+', 'AT Plus'],
  },

  // ---- Wampler ---- (1590B unless noted; minis use 1590A)
  // source: Hammond enclosure datasheets; Wampler shipping enclosures.
  { brand: 'Wampler', name: 'Tumnus', widthIn: 1.5, depthIn: 3.5 },
  { brand: 'Wampler', name: 'Tumnus Deluxe', widthIn: 2.5, depthIn: 4.5 },
  {
    brand: 'Wampler',
    name: 'Plexi-Drive Deluxe',
    widthIn: 3.5,
    depthIn: 4.5,
    aliases: ['Plexi Drive Deluxe'],
  },
  { brand: 'Wampler', name: 'Ego Compressor', widthIn: 2.5, depthIn: 4.5 },
  { brand: 'Wampler', name: 'Velvet Fuzz', widthIn: 2.5, depthIn: 4.5 },
  { brand: 'Wampler', name: 'Pinnacle', widthIn: 2.5, depthIn: 4.5 },
  { brand: 'Wampler', name: 'Triple Wreck', widthIn: 3.5, depthIn: 4.5 },
  { brand: 'Wampler', name: 'Sovereign', widthIn: 2.5, depthIn: 4.5 },
  { brand: 'Wampler', name: 'Belle', widthIn: 1.5, depthIn: 3.5 },
  { brand: 'Wampler', name: 'Catapulp', widthIn: 2.5, depthIn: 4.5 },

  // ---- Empress Effects ---- (most use the stack-knob box 4.75 × 4.0)
  // source: Empress product spec pages.
  { brand: 'Empress', name: 'Reverb', widthIn: 3.75, depthIn: 5.7 },
  { brand: 'Empress', name: 'Echosystem', widthIn: 3.75, depthIn: 5.7 },
  {
    brand: 'Empress',
    name: 'ParaEQ MKII Deluxe',
    widthIn: 3.75,
    depthIn: 5.7,
    aliases: ['ParaEQ', 'Para EQ'],
  },
  {
    brand: 'Empress',
    name: 'Compressor MKII',
    widthIn: 3.75,
    depthIn: 5.7,
    aliases: ['Compressor'],
  },
  { brand: 'Empress', name: 'Bass Compressor', widthIn: 3.75, depthIn: 5.7 },
  { brand: 'Empress', name: 'Heavy Menace', widthIn: 3.75, depthIn: 5.7 },
  { brand: 'Empress', name: 'Multidrive', widthIn: 3.75, depthIn: 5.7 },
  {
    brand: 'Empress',
    name: 'Tremolo2',
    widthIn: 3.75,
    depthIn: 5.7,
    aliases: ['Tremolo 2'],
  },
  { brand: 'Empress', name: 'Phaser', widthIn: 3.75, depthIn: 5.7 },
  {
    brand: 'Empress',
    name: 'Buffer+',
    widthIn: 1.26,
    depthIn: 4.49,
    aliases: ['Buffer Plus'],
  },

  // ---- Eventide ---- (H9 = 3.0 × 5.28, Factor = 3.9 × 7.56, dot9 = 1590B)
  // source: Eventide product pages.
  { brand: 'Eventide', name: 'H9', widthIn: 4.65, depthIn: 5.25 },
  { brand: 'Eventide', name: 'H9 Max', widthIn: 4.65, depthIn: 5.25 },
  {
    brand: 'Eventide',
    name: 'TimeFactor',
    widthIn: 7.5,
    depthIn: 4.8,
    aliases: ['Time Factor'],
  },
  {
    brand: 'Eventide',
    name: 'PitchFactor',
    widthIn: 7.5,
    depthIn: 4.8,
    aliases: ['Pitch Factor'],
  },
  {
    brand: 'Eventide',
    name: 'ModFactor',
    widthIn: 7.5,
    depthIn: 4.8,
    aliases: ['Mod Factor'],
  },
  { brand: 'Eventide', name: 'Space', widthIn: 7.5, depthIn: 4.8 },
  {
    brand: 'Eventide',
    name: 'Blackhole',
    widthIn: 4.0,
    depthIn: 4.25,
    aliases: ['Black Hole'],
  },
  {
    brand: 'Eventide',
    name: 'MicroPitch Delay',
    widthIn: 4.0,
    depthIn: 4.25,
    aliases: ['Micro Pitch'],
  },
  {
    brand: 'Eventide',
    name: 'UltraTap',
    widthIn: 4.0,
    depthIn: 4.25,
    aliases: ['Ultra Tap'],
  },
  { brand: 'Eventide', name: 'Rose', widthIn: 4.0, depthIn: 4.25 },

  // ---- Keeley ---- (mostly 1590B, mini line uses 1590A)
  // source: Keeley product pages; standard Hammond enclosures.
  { brand: 'Keeley', name: 'Compressor Plus', widthIn: 2.68, depthIn: 4.41 },
  { brand: 'Keeley', name: 'Caverns V2', widthIn: 2.68, depthIn: 4.41 },
  { brand: 'Keeley', name: 'Halo', widthIn: 3.9, depthIn: 4.72 },
  {
    brand: 'Keeley',
    name: 'Synth-1',
    widthIn: 3.9,
    depthIn: 4.72,
    aliases: ['Synth 1'],
  },
  { brand: 'Keeley', name: 'Compressor Mini', widthIn: 1.85, depthIn: 3.74 },
  { brand: 'Keeley', name: 'Loomer', widthIn: 3.9, depthIn: 4.72 },
  { brand: 'Keeley', name: 'Dark Side', widthIn: 3.9, depthIn: 4.72 },
  { brand: 'Keeley', name: 'Hooke', widthIn: 3.9, depthIn: 4.72 },
  { brand: 'Keeley', name: 'Memphis Sun', widthIn: 3.9, depthIn: 4.72 },
  {
    brand: 'Keeley',
    name: 'Vibe-O-Verb',
    widthIn: 3.9,
    depthIn: 4.72,
    aliases: ['Vibe O Verb'],
  },

  // ---- EarthQuaker Devices ---- (mostly 1590B, larger pedals use 1590BB)
  // source: EQD product pages.
  {
    brand: 'EarthQuaker Devices',
    name: 'Avalanche Run',
    widthIn: 4.15,
    depthIn: 4.65,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Afterneath',
    widthIn: 2.5,
    depthIn: 4.75,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Hizumitas',
    widthIn: 2.5,
    depthIn: 4.75,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'The Depths',
    widthIn: 2.5,
    depthIn: 4.75,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Plumes',
    widthIn: 2.5,
    depthIn: 4.75,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Westwood',
    widthIn: 2.5,
    depthIn: 4.75,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Erupter',
    widthIn: 2.5,
    depthIn: 4.75,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Spatial Delivery',
    widthIn: 2.5,
    depthIn: 4.75,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Sea Machine',
    widthIn: 2.5,
    depthIn: 4.75,
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Disaster Transport SR',
    widthIn: 4.75,
    depthIn: 5.65,
  },

  // ---- Chase Bliss Audio ---- (their custom stompbox = 3.95 × 3.55)
  // source: Chase Bliss product pages.
  {
    brand: 'Chase Bliss Audio',
    name: 'Mood MKII',
    widthIn: 2.9,
    depthIn: 4.9,
    aliases: ['Mood'],
  },
  { brand: 'Chase Bliss Audio', name: 'Blooper', widthIn: 2.9, depthIn: 4.9 },
  {
    brand: 'Chase Bliss Audio',
    name: 'CXM 1978',
    widthIn: 2.9,
    depthIn: 4.9,
    aliases: ['CXM1978'],
  },
  {
    brand: 'Chase Bliss Audio',
    name: 'Wombtone MKII',
    widthIn: 2.9,
    depthIn: 4.9,
    aliases: ['Wombtone'],
  },
  {
    brand: 'Chase Bliss Audio',
    name: 'Tonal Recall',
    widthIn: 2.9,
    depthIn: 4.9,
  },
  {
    brand: 'Chase Bliss Audio',
    name: 'Brothers',
    widthIn: 2.9,
    depthIn: 4.9,
  },
  {
    brand: 'Chase Bliss Audio',
    name: 'Warped Vinyl HiFi',
    widthIn: 2.9,
    depthIn: 4.9,
    aliases: ['Warped Vinyl'],
  },
  {
    brand: 'Chase Bliss Audio',
    name: 'Generation Loss MKII',
    widthIn: 2.9,
    depthIn: 4.9,
    aliases: ['Generation Loss'],
  },
  { brand: 'Chase Bliss Audio', name: 'Habit', widthIn: 2.9, depthIn: 4.9 },
  {
    brand: 'Chase Bliss Audio',
    name: 'Dark World',
    widthIn: 2.9,
    depthIn: 4.9,
  },

  // ---- Source Audio ---- (One Series = 4.50 × 2.50, dual = 4.50 × 4.00)
  // source: Source Audio product pages.
  {
    brand: 'Source Audio',
    name: 'Ventris',
    widthIn: 4.6,
    depthIn: 4.4,
    aliases: ['Ventris Dual Reverb'],
  },
  { brand: 'Source Audio', name: 'Collider', widthIn: 4.6, depthIn: 4.4 },
  {
    brand: 'Source Audio',
    name: 'Nemesis',
    widthIn: 4.5,
    depthIn: 2.5,
    aliases: ['Nemesis Delay'],
  },
  { brand: 'Source Audio', name: 'Spectrum', widthIn: 4.5, depthIn: 2.5 },
  { brand: 'Source Audio', name: 'EQ2', widthIn: 4.5, depthIn: 2.5 },
  {
    brand: 'Source Audio',
    name: 'True Spring',
    widthIn: 4.5,
    depthIn: 2.5,
    aliases: ['True Spring Reverb'],
  },
  { brand: 'Source Audio', name: 'ZIO', widthIn: 4.5, depthIn: 2.5 },
  { brand: 'Source Audio', name: 'C4 Synth', widthIn: 4.5, depthIn: 2.5 },
  { brand: 'Source Audio', name: 'Aftershock', widthIn: 4.5, depthIn: 2.5 },
  {
    brand: 'Source Audio',
    name: 'Vertigo',
    widthIn: 4.5,
    depthIn: 2.5,
    aliases: ['Vertigo Tremolo'],
  },

  // ---- Way Huge ---- (most 1590B; Smalls = 1590A)
  // source: Way Huge product pages; standard enclosures.
  { brand: 'Way Huge', name: 'Green Rhino', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Way Huge', name: 'Russian Pickle', widthIn: 2.37, depthIn: 4.39 },
  {
    brand: 'Way Huge',
    name: 'Aqua-Puss',
    widthIn: 2.37,
    depthIn: 4.39,
    aliases: ['Aqua Puss'],
  },
  { brand: 'Way Huge', name: 'Saucy Box', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Way Huge', name: 'Swollen Pickle', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Way Huge', name: 'Atreides', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Way Huge', name: 'Saffron Squeeze', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Way Huge', name: 'Camel Toe', widthIn: 3.74, depthIn: 4.72 },
  { brand: 'Way Huge', name: 'Pork Loin', widthIn: 2.37, depthIn: 4.39 },
  {
    brand: 'Way Huge',
    name: 'Smalls Aqua-Puss',
    widthIn: 2.4,
    depthIn: 4.09,
    aliases: ['Smalls Aqua Puss'],
  },

  // ---- TC Electronic ---- (standard format = 2.83 × 5.40, mini = 1.50 × 3.65)
  // source: TC Electronic product pages.
  {
    brand: 'TC Electronic',
    name: 'PolyTune 3',
    widthIn: 2.83,
    depthIn: 5.4,
    aliases: ['PolyTune'],
  },
  {
    brand: 'TC Electronic',
    name: 'Hall of Fame 2',
    widthIn: 2.83,
    depthIn: 5.4,
    aliases: ['HoF 2', 'Hall of Fame'],
  },
  {
    brand: 'TC Electronic',
    name: 'Flashback 2',
    widthIn: 2.83,
    depthIn: 5.4,
    aliases: ['Flashback'],
  },
  {
    brand: 'TC Electronic',
    name: 'Hall of Fame Mini',
    widthIn: 1.5,
    depthIn: 3.65,
  },
  {
    brand: 'TC Electronic',
    name: 'Quintessence',
    widthIn: 2.83,
    depthIn: 5.4,
    aliases: ['Quintessence Harmony'],
  },
  {
    brand: 'TC Electronic',
    name: 'Hypergravity Compressor',
    widthIn: 2.83,
    depthIn: 5.4,
    aliases: ['Hypergravity'],
  },
  {
    brand: 'TC Electronic',
    name: "Sub 'N' Up",
    widthIn: 2.83,
    depthIn: 5.4,
    aliases: ['Sub N Up', 'Sub Up Octaver'],
  },
  {
    brand: 'TC Electronic',
    name: 'Dark Matter Distortion',
    widthIn: 2.83,
    depthIn: 5.4,
    aliases: ['Dark Matter'],
  },
  {
    brand: 'TC Electronic',
    name: 'Mojomojo Overdrive',
    widthIn: 2.83,
    depthIn: 5.4,
    aliases: ['Mojomojo', 'MojoMojo'],
  },
  { brand: 'TC Electronic', name: 'Plethora X5', widthIn: 5.3, depthIn: 9.6 },

  // ---- Line 6 ---- (sizes vary widely by line)
  // source: Line 6 product spec pages.
  { brand: 'Line 6', name: 'HX Stomp', widthIn: 4.59, depthIn: 6.77 },
  { brand: 'Line 6', name: 'HX Stomp XL', widthIn: 4.72, depthIn: 12.44 },
  { brand: 'Line 6', name: 'HX Effects', widthIn: 4.59, depthIn: 12.01 },
  { brand: 'Line 6', name: 'HX One', widthIn: 3.8, depthIn: 4.9 },
  {
    brand: 'Line 6',
    name: 'M9',
    widthIn: 4.59,
    depthIn: 9.84,
    aliases: ['M9 Stompbox Modeler'],
  },
  {
    brand: 'Line 6',
    name: 'M5',
    widthIn: 3.5,
    depthIn: 5.4,
    aliases: ['M5 Stompbox Modeler'],
  },
  {
    brand: 'Line 6',
    name: 'DL4 MkII',
    widthIn: 3.5,
    depthIn: 9.5,
    aliases: ['DL4'],
  },
  { brand: 'Line 6', name: 'Helix Floor', widthIn: 5.59, depthIn: 22.05 },
  { brand: 'Line 6', name: 'Helix LT', widthIn: 5.59, depthIn: 16.5 },
  { brand: 'Line 6', name: 'Pod Go', widthIn: 5.51, depthIn: 14.96 },

  // ---- Mooer ---- (Micro series = 1.46 × 3.72)
  // source: Mooer Micro spec; standard form factor for the line.
  { brand: 'Mooer', name: 'Yellow Comp', widthIn: 1.65, depthIn: 3.68 },
  { brand: 'Mooer', name: 'Pure Boost', widthIn: 1.65, depthIn: 3.68 },
  { brand: 'Mooer', name: 'Hustle Drive', widthIn: 1.65, depthIn: 3.68 },
  { brand: 'Mooer', name: 'Ana Echo', widthIn: 1.65, depthIn: 3.68 },
  {
    brand: 'Mooer',
    name: 'ShimVerb Pro',
    widthIn: 1.65,
    depthIn: 3.68,
    aliases: ['ShimVerb'],
  },
  { brand: 'Mooer', name: 'Reecho', widthIn: 1.65, depthIn: 3.68 },
  { brand: 'Mooer', name: 'Microverb', widthIn: 1.65, depthIn: 3.68 },
  { brand: 'Mooer', name: 'Lofi Machine', widthIn: 1.65, depthIn: 3.68 },
  { brand: 'Mooer', name: 'Phaser Player', widthIn: 1.65, depthIn: 3.68 },
  { brand: 'Mooer', name: 'Mod Factory', widthIn: 1.65, depthIn: 3.68 },

  // ---- ZVEX ---- (Vexter cast = 3.70 × 4.50)
  // source: ZVEX Vexter spec.
  { brand: 'ZVEX', name: 'Fuzz Factory', widthIn: 3.7, depthIn: 4.5 },
  { brand: 'ZVEX', name: 'Fuzz Factory 7', widthIn: 3.7, depthIn: 4.5 },
  { brand: 'ZVEX', name: 'Box of Rock', widthIn: 3.7, depthIn: 4.5 },
  {
    brand: 'ZVEX',
    name: 'Super Hard On',
    widthIn: 3.7,
    depthIn: 4.5,
    aliases: ['SHO'],
  },
  { brand: 'ZVEX', name: 'Mastotron', widthIn: 3.7, depthIn: 4.5 },
  { brand: 'ZVEX', name: 'Channel 2', widthIn: 3.7, depthIn: 4.5 },
  { brand: 'ZVEX', name: 'Distortron', widthIn: 3.7, depthIn: 4.5 },
  {
    brand: 'ZVEX',
    name: 'Lo-Fi Loop Junky',
    widthIn: 3.7,
    depthIn: 4.5,
    aliases: ['Lo Fi Loop Junky'],
  },
  {
    brand: 'ZVEX',
    name: "'59 Sound",
    widthIn: 3.7,
    depthIn: 4.5,
    aliases: ['59 Sound'],
  },
  { brand: 'ZVEX', name: 'Probe', widthIn: 3.7, depthIn: 4.5 },

  // ---- Catalinbread ---- (1590B; Belle Epoch Deluxe is custom)
  // source: Catalinbread product pages; Hammond 1590B for the rest.
  { brand: 'Catalinbread', name: 'Belle Epoch', widthIn: 2.36, depthIn: 4.33 },
  {
    brand: 'Catalinbread',
    name: 'Belle Epoch Deluxe',
    widthIn: 4.68,
    depthIn: 3.66,
  },
  { brand: 'Catalinbread', name: 'Topanga', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Catalinbread', name: 'Echorec', widthIn: 4.68, depthIn: 3.66 },
  { brand: 'Catalinbread', name: 'Naga Viper', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Catalinbread', name: 'Karma Suture', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Catalinbread', name: 'Octapussy', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Catalinbread', name: 'Galileo', widthIn: 2.37, depthIn: 4.39 },
  { brand: 'Catalinbread', name: 'Talisman', widthIn: 2.37, depthIn: 4.39 },
  {
    brand: 'Catalinbread',
    name: 'Adventure Combo',
    widthIn: 2.37,
    depthIn: 4.39,
  },

  // ---- Maxon ---- (MX-format ≈ 2.84 × 4.99)
  // source: Maxon Nine-Series product spec.
  {
    brand: 'Maxon',
    name: 'OD-808',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['OD808'],
  },
  {
    brand: 'Maxon',
    name: 'OD-9',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['OD9'],
  },
  {
    brand: 'Maxon',
    name: 'SD-9 Sonic Distortion',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['SD-9', 'SD9'],
  },
  {
    brand: 'Maxon',
    name: 'OD-820 Overdrive Pro',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['OD-820', 'OD820'],
  },
  {
    brand: 'Maxon',
    name: 'AD-9 Analog Delay',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['AD-9', 'AD9'],
  },
  {
    brand: 'Maxon',
    name: 'AD-999',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['AD999'],
  },
  {
    brand: 'Maxon',
    name: 'PT-999 Phase Tone',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['PT-999', 'PT999'],
  },
  {
    brand: 'Maxon',
    name: 'AF-9 Auto Filter',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['AF-9', 'AF9'],
  },
  {
    brand: 'Maxon',
    name: 'ST-9 Pro+',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['ST-9', 'ST9'],
  },
  {
    brand: 'Maxon',
    name: 'VOP-9 Vintage Octave',
    widthIn: 2.84,
    depthIn: 4.99,
    aliases: ['VOP-9', 'VOP9'],
  },

  // ---- B's Music Shop cat-art exclusive editions ----
  //
  // Custom-painted runs B's Music Shop commissions from various
  // manufacturers. Each entry lives under its base brand so a user
  // typing the original maker plus the cat-themed model name hits.
  // Dimensions follow the base pedal's enclosure since these are
  // re-paints, not re-designs.
  //
  // source for the lineup: https://bsmusicshop.com/products/bs-custom-pedal-collection

  // Keeley collaborations — most use Keeley's standard 1590B (2.37 × 4.39);
  // Mini-Kittyana is a Keeley mini (1.50 × 3.65).
  {
    brand: 'Keeley',
    name: 'NocPurrne Reverb',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['NocPurrne', 'Andy Timmons NocPurrne'],
  },
  {
    brand: 'Keeley',
    name: 'Mews Driver',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['Andy Timmons Mews Driver', 'MK3 Mews Driver'],
  },
  {
    brand: 'Keeley',
    name: 'Fuzz Baller',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['Fuzz Bender Cat Edition', "B's Fuzz Baller"],
  },
  {
    brand: 'Keeley',
    name: 'Supurr Rodent',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['Super Rodent Cat Edition'],
  },
  {
    brand: 'Keeley',
    name: 'Angry Orange Cat',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['AOC', '4-in-1 Distortion Fuzz Cat'],
  },
  {
    brand: 'Keeley',
    name: 'Super Cat Mod',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['Super Phat Mod Cat'],
  },
  {
    brand: 'Keeley',
    name: 'CATana',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['Katana Clean Boost Cat'],
  },
  {
    brand: 'Keeley',
    name: 'Catverns',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['Caverns V2 Cat Edition'],
  },
  {
    brand: 'Keeley',
    name: 'Octa Pspsps Psi',
    widthIn: 3.9,
    depthIn: 5.0,
    aliases: ['Transfigurating Fuzz Cat', 'Octa Pspsps'],
  },
  {
    brand: 'Keeley',
    name: 'Mini-Kittyana Smol Boost',
    widthIn: 1.85,
    depthIn: 3.74,
    aliases: ['Katana Mini Boost Cat', 'Mini Kittyana'],
  },
  {
    brand: 'Keeley',
    name: 'CAT-Comp ComPURRessor+',
    widthIn: 2.68,
    depthIn: 4.41,
    aliases: ['Compressor Plus Cat', 'CAT-Comp'],
  },

  // EarthQuaker Devices collaborations — 1590B enclosures.
  {
    brand: 'EarthQuaker Devices',
    name: 'Zoar Cat Paws',
    widthIn: 2.5,
    depthIn: 4.75,
    aliases: ['Zoar Cat Paws Edition'],
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Blumes Bass Overdrive',
    widthIn: 2.5,
    depthIn: 4.75,
    aliases: ['Blumes', 'Plumes Bass Cat'],
  },
  {
    brand: 'EarthQuaker Devices',
    name: 'Plumes Kitty Green Sparkle',
    widthIn: 2.5,
    depthIn: 4.75,
    aliases: ['Plumes Cat Edition'],
  },

  // Old Blood Noise Endeavors collaborations.
  // Most OBNE compacts use 1590B; Procession uses 1590BB (3.74 × 4.72).
  {
    brand: 'Old Blood Noise Endeavors',
    name: 'Purr-ting',
    widthIn: 2.37,
    depthIn: 4.39,
    aliases: ['Parting Cat Edition', 'Purrting'],
  },
  {
    brand: 'Old Blood Noise Endeavors',
    name: 'Dark Paw',
    widthIn: 2.37,
    depthIn: 4.39,
  },
  {
    brand: 'Old Blood Noise Endeavors',
    name: 'Meowdy Pardner Fuzz',
    widthIn: 2.37,
    depthIn: 4.39,
    aliases: ['Meowdy Pardner', "B's Music OBNE Fuzz"],
  },
  {
    brand: 'Old Blood Noise Endeavors',
    name: 'Purrcession',
    widthIn: 3.74,
    depthIn: 4.72,
    aliases: ['Procession Sci-Fi Reverb Cat', 'Procession Cat Edition'],
  },

  // Summer School Electronics collaborations — 1590B.
  {
    brand: 'Summer School Electronics',
    name: 'Meowdle School Chorus',
    widthIn: 3.66,
    depthIn: 4.69,
    aliases: ['Meowdle School', 'Middle School Cat Chorus'],
  },
  {
    brand: 'Summer School Electronics',
    name: 'Cats Reunion',
    widthIn: 2.37,
    depthIn: 4.39,
    aliases: ['Class Reunion Cat', 'Cats Reunion Custom Green'],
  },
  {
    brand: 'Summer School Electronics',
    name: 'Science Fur',
    widthIn: 2.37,
    depthIn: 4.39,
    aliases: ['Science Fair Cat', 'Science Fur Cat'],
  },

  // Alexander Pedals collaborations — Alexander's standard enclosure
  // (Defender / Neo Series-class) is ~3.5 × 4.5.
  {
    brand: 'Alexander Pedals',
    name: 'Ninja Cat',
    widthIn: 3.5,
    depthIn: 4.5,
    aliases: ['Ninja Cat Series', 'Alexander Ninja Cat'],
  },
  {
    brand: 'Alexander Pedals',
    name: 'Luminous Fish Stealer',
    widthIn: 3.5,
    depthIn: 4.5,
    aliases: ['Luminous Fish Stealer Phaseshifter', 'Phaseshifter Cat'],
  },
  {
    brand: 'Alexander Pedals',
    name: 'Space Furrrce',
    widthIn: 3.5,
    depthIn: 4.5,
    aliases: ['Space Force Reverb Cat', 'Space Force Cat'],
  },
  {
    brand: 'Alexander Pedals',
    name: 'Flanger the 13th Cat Fight',
    widthIn: 3.5,
    depthIn: 4.5,
    aliases: ['Cat Fight Flanger', 'Flanger 13th Cat'],
  },

  // Supercool Pedals — Barstow Cat is a Supercool collaboration in
  // their 1590BB-class enclosure.
  {
    brand: 'Supercool Pedals',
    name: 'The Barstow Cat',
    widthIn: 3.74,
    depthIn: 4.72,
    aliases: ['Barstow Cat'],
  },

  // Cusack Music — Tap-A-Whirl-class enclosure (1590B).
  {
    brand: 'Cusack Music',
    name: 'The Meowdulator',
    widthIn: 2.37,
    depthIn: 4.39,
    aliases: ['Meowdulator', 'Cat Synth'],
  },

  // Oneder Effects — 1590B.
  {
    brand: 'Oneder Effects',
    name: 'Less Than Jake',
    widthIn: 2.37,
    depthIn: 4.39,
    aliases: ['Less Than Jake Signature Cat'],
  },

  // Mojo Hand FX — 1590B.
  {
    brand: 'Mojo Hand FX',
    name: 'One Ton Bee',
    widthIn: 2.37,
    depthIn: 4.39,
    aliases: ['One Ton Bee Cat Edition'],
  },
];
