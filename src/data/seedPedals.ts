/**
 * Pre-loaded "default" pedals that ship with the app.
 *
 * These are inserted on every launch if a pedal with the same (brand, name)
 * isn't already in the library — so the user can edit them, and deleting
 * a default makes it come back on next launch. Match key is (brand, name);
 * if the user renames their copy of Tabby Terror, a fresh Tabby Terror is
 * re-seeded next launch.
 *
 * Images are bundled as `?inline` data URLs so the stored `imagePath` is a
 * data URL — the same shape as user-added pedals, which keeps rig export
 * portable.
 */
import tabbyTerrorImg from '../assets/pedals/tabby-terror.png?inline';
import tortieTudeImg from '../assets/pedals/tortie-tude.png?inline';
import { createPedal, listPedals, type CreatePedalInput } from './pedalsRepo';

export const SEED_PEDALS: readonly CreatePedalInput[] = [
  {
    brand: 'Stray Circuits',
    name: 'Tabby Terror',
    widthIn: 2.63,
    depthIn: 4.7,
    imagePath: tabbyTerrorImg,
    jackSides: {
      top: true,
      bottom: false,
      left: false,
      right: false,
      midi_top: false,
      midi_bottom: false,
      midi_left: false,
      midi_right: false,
    },
    powerSide: 'top',
    ports: [
      {
        label: 'Out',
        role: 'output',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 0,
        optional: false,
      },
      {
        label: 'In',
        role: 'input',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 1,
        optional: false,
      },
    ],
  },
  {
    brand: 'Stray Circuits',
    name: 'Tortie Tude',
    widthIn: 2.6,
    depthIn: 4.72,
    imagePath: tortieTudeImg,
    jackSides: {
      top: true,
      bottom: false,
      left: false,
      right: false,
      midi_top: false,
      midi_bottom: false,
      midi_left: false,
      midi_right: false,
    },
    powerSide: 'top',
    ports: [
      {
        label: 'Out',
        role: 'output',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 0,
        optional: false,
      },
      {
        label: 'In',
        role: 'input',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 1,
        optional: false,
      },
    ],
  },
];

/**
 * Insert any {@link SEED_PEDALS} that aren't already in the library, matched
 * on (brand, name). Safe to call on every launch.
 *
 * Concurrent calls share the same in-flight promise so React 18 StrictMode
 * (which double-invokes effects in dev) doesn't race past the existence
 * check and insert duplicates.
 */
export function seedDefaultPedals(): Promise<void> {
  inFlight ??= runSeed().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let inFlight: Promise<void> | null = null;

async function runSeed(): Promise<void> {
  const existing = await listPedals();
  const existingKey = new Set(existing.map((p) => `${p.brand}|${p.name}`));
  for (const spec of SEED_PEDALS) {
    if (existingKey.has(`${spec.brand}|${spec.name}`)) continue;
    await createPedal(spec);
  }
}

/** Test-only: drop the in-flight cache so each test starts clean. */
export function __resetSeedPedalsForTests(): void {
  inFlight = null;
}
