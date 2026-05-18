/**
 * Dev-only seed of 6 common pedals.
 *
 * Until the add-pedal wizard (phase 4) lands, this is how we get pedals into
 * the local library so we can exercise the canvas. Each pedal records its
 * placeholder color via `imagePath: "color:#RRGGBB"` — the canvas renderer
 * understands this prefix and draws a flat colored rectangle until a real
 * image is uploaded.
 */
import type { CreatePedalInput } from './pedalsRepo';
import { createPedal, listPedals } from './pedalsRepo';

interface SeedSpec {
  id: string;
  brand: string;
  name: string;
  widthIn: number;
  depthIn: number;
  color: string;
  /** Stereo pedals get an output_l/output_r pair instead of a single output. */
  stereoOut?: boolean;
  /** Adds MIDI in/out ports on the bottom edge. */
  midi?: boolean;
}

const SEEDS: SeedSpec[] = [
  {
    id: 'seed-boss-ds1',
    brand: 'Boss',
    name: 'DS-1',
    widthIn: 2.85,
    depthIn: 4.75,
    color: '#C62828',
  },
  {
    id: 'seed-mxr-phase90',
    brand: 'MXR',
    name: 'Phase 90',
    widthIn: 2.25,
    depthIn: 4.4,
    color: '#2E7D32',
  },
  {
    id: 'seed-boss-dd8',
    brand: 'Boss',
    name: 'DD-8',
    widthIn: 2.85,
    depthIn: 4.75,
    color: '#1565C0',
    stereoOut: true,
  },
  {
    id: 'seed-strymon-timeline',
    brand: 'Strymon',
    name: 'Timeline',
    widthIn: 6.75,
    depthIn: 4.5,
    color: '#4A148C',
    stereoOut: true,
    midi: true,
  },
  {
    id: 'seed-strymon-iridium',
    brand: 'Strymon',
    name: 'Iridium',
    widthIn: 6.75,
    depthIn: 4.5,
    color: '#37474F',
    stereoOut: true,
    midi: true,
  },
  {
    id: 'seed-ehx-big-muff',
    brand: 'EHX',
    name: 'Big Muff Nano',
    widthIn: 2.5,
    depthIn: 4.5,
    color: '#E65100',
  },
];

function specToInput(spec: SeedSpec): CreatePedalInput {
  const ports: CreatePedalInput['ports'] = [
    // Mono input — top edge, rightmost (sideOrder=1 with the output at 0)
    {
      label: 'In',
      role: 'input',
      signalType: 'instrument',
      connector: 'ts',
      side: 'top',
      sideOrder: 1,
      optional: false,
    },
  ];
  if (spec.stereoOut) {
    ports.push(
      {
        label: 'Out L',
        role: 'output_l',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 0,
        optional: false,
      },
      {
        label: 'Out R',
        role: 'output_r',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 2,
        optional: true,
      },
    );
  } else {
    ports.push({
      label: 'Out',
      role: 'output',
      signalType: 'instrument',
      connector: 'ts',
      side: 'top',
      sideOrder: 0,
      optional: false,
    });
  }
  if (spec.midi) {
    ports.push(
      {
        label: 'MIDI In',
        role: 'midi_in',
        signalType: 'midi',
        connector: 'midi_trs',
        side: 'bottom',
        sideOrder: 0,
        optional: true,
      },
      {
        label: 'MIDI Out',
        role: 'midi_out',
        signalType: 'midi',
        connector: 'midi_trs',
        side: 'bottom',
        sideOrder: 1,
        optional: true,
      },
    );
  }
  return {
    id: spec.id,
    brand: spec.brand,
    name: spec.name,
    widthIn: spec.widthIn,
    depthIn: spec.depthIn,
    imagePath: `color:${spec.color}`,
    jackSides: {
      top: true,
      bottom: !!spec.midi,
      left: false,
      right: false,
      midi_top: false,
      midi_bottom: !!spec.midi,
      midi_left: false,
      midi_right: false,
    },
    powerSide: 'bottom',
    ports,
  };
}

/**
 * Adds any missing seed pedals to the local DB. Idempotent — pedals that
 * already exist (matched by id) are left alone.
 */
export async function seedSamplePedals(): Promise<{ added: number }> {
  const existing = await listPedals();
  const existingIds = new Set(existing.map((p) => p.id));
  let added = 0;
  for (const spec of SEEDS) {
    if (existingIds.has(spec.id)) continue;
    await createPedal(specToInput(spec));
    added++;
  }
  return { added };
}

/**
 * Decode a pedal's imagePath. Returns a color string (for `color:#RRGGBB`
 * placeholders) or null if it's a real image URL / path (we'll wire image
 * loading in phase 4) or absent.
 */
export function colorFromImagePath(imagePath: string | null): string | null {
  if (!imagePath) return null;
  if (imagePath.startsWith('color:')) return imagePath.slice('color:'.length);
  return null;
}
