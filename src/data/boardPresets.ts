import type { BoardStyle } from './schema';

import classic1Img from '../assets/boards/classic-1.png';
import classic2Img from '../assets/boards/classic-2.png';
import classic3Img from '../assets/boards/classic-3.png';
import classicJrImg from '../assets/boards/classic-jr.png';
import classicProImg from '../assets/boards/classic-pro.png';
import jrMaxImg from '../assets/boards/jr-max.png';
import metro16Img from '../assets/boards/metro-16.png';
import metro20Img from '../assets/boards/metro-20.png';
import metro24Img from '../assets/boards/metro-24.png';
import metroMaxImg from '../assets/boards/metro-max.png';
import nanoImg from '../assets/boards/nano.png';
import nanoPlusImg from '../assets/boards/nano-plus.png';
import nanoMaxImg from '../assets/boards/nano-max.png';
import novo18Img from '../assets/boards/novo-18.png';
import novo24Img from '../assets/boards/novo-24.png';
import novo32Img from '../assets/boards/novo-32.png';
import terra42Img from '../assets/boards/terra-42.png';
import xd18Img from '../assets/boards/xd-18.png';
import xd24Img from '../assets/boards/xd-24.png';

export type BoardSeries =
  // Pedaltrain
  | 'Nano'
  | 'Metro'
  | 'Classic'
  | 'Novo'
  | 'Large'
  // Temple Audio
  | 'Solo'
  | 'Duo'
  | 'Trio';

/** Order Pedaltrain series should appear in the picker. */
export const PEDALTRAIN_SERIES_ORDER: readonly BoardSeries[] = [
  'Nano',
  'Metro',
  'Classic',
  'Novo',
  'Large',
] as const;

/** Order Temple Audio series should appear in the picker. */
export const TEMPLE_AUDIO_SERIES_ORDER: readonly BoardSeries[] = [
  'Solo',
  'Duo',
  'Trio',
] as const;

export interface BoardPreset {
  id: string;
  brand: string;
  name: string;
  widthIn: number;
  depthIn: number;
  style: BoardStyle;
  /** Bundled PNG URL. When present, the canvas draws this instead of the procedural style. */
  image?: string;
  /** Used to group Pedaltrain boards in the picker. Optional for other brands. */
  series?: BoardSeries;
}

export const BOARD_PRESETS: readonly BoardPreset[] = [
  // Pedaltrain — Nano
  {
    id: 'pedaltrain-nano',
    brand: 'Pedaltrain',
    name: 'Nano',
    widthIn: 14,
    depthIn: 5.5,
    style: 'rail',
    image: nanoImg,
    series: 'Nano',
  },
  {
    id: 'pedaltrain-nano-plus',
    brand: 'Pedaltrain',
    name: 'Nano+',
    widthIn: 18,
    depthIn: 5,
    style: 'rail',
    image: nanoPlusImg,
    series: 'Nano',
  },
  {
    id: 'pedaltrain-nano-max',
    brand: 'Pedaltrain',
    name: 'Nano MAX',
    widthIn: 28,
    depthIn: 5.5,
    style: 'rail',
    image: nanoMaxImg,
    series: 'Nano',
  },
  // Pedaltrain — Metro
  {
    id: 'pedaltrain-metro-16',
    brand: 'Pedaltrain',
    name: 'Metro 16',
    widthIn: 16,
    depthIn: 8,
    style: 'rail',
    image: metro16Img,
    series: 'Metro',
  },
  {
    id: 'pedaltrain-metro-20',
    brand: 'Pedaltrain',
    name: 'Metro 20',
    widthIn: 20,
    depthIn: 8,
    style: 'rail',
    image: metro20Img,
    series: 'Metro',
  },
  {
    id: 'pedaltrain-metro-24',
    brand: 'Pedaltrain',
    name: 'Metro 24',
    widthIn: 24,
    depthIn: 8,
    style: 'rail',
    image: metro24Img,
    series: 'Metro',
  },
  {
    id: 'pedaltrain-metro-max',
    brand: 'Pedaltrain',
    name: 'Metro MAX',
    widthIn: 28,
    depthIn: 8,
    style: 'rail',
    image: metroMaxImg,
    series: 'Metro',
  },
  // Pedaltrain — Classic
  {
    id: 'pedaltrain-classic-1',
    brand: 'Pedaltrain',
    name: 'Classic 1',
    widthIn: 22,
    depthIn: 12.5,
    style: 'rail',
    image: classic1Img,
    series: 'Classic',
  },
  {
    id: 'pedaltrain-classic-2',
    brand: 'Pedaltrain',
    name: 'Classic 2',
    widthIn: 24,
    depthIn: 12.5,
    style: 'rail',
    image: classic2Img,
    series: 'Classic',
  },
  {
    id: 'pedaltrain-classic-3',
    brand: 'Pedaltrain',
    name: 'Classic 3',
    widthIn: 24,
    depthIn: 16,
    style: 'rail',
    image: classic3Img,
    series: 'Classic',
  },
  {
    id: 'pedaltrain-classic-jr',
    brand: 'Pedaltrain',
    name: 'Classic JR',
    widthIn: 18,
    depthIn: 12.5,
    style: 'rail',
    image: classicJrImg,
    series: 'Classic',
  },
  {
    id: 'pedaltrain-classic-pro',
    brand: 'Pedaltrain',
    name: 'Classic Pro',
    widthIn: 32,
    depthIn: 16,
    style: 'rail',
    image: classicProImg,
    series: 'Classic',
  },
  {
    id: 'pedaltrain-jr-max',
    brand: 'Pedaltrain',
    name: 'JR MAX',
    widthIn: 28,
    depthIn: 12.5,
    style: 'rail',
    image: jrMaxImg,
    series: 'Classic',
  },
  // Pedaltrain — Novo
  {
    id: 'pedaltrain-novo-18',
    brand: 'Pedaltrain',
    name: 'Novo 18',
    widthIn: 18,
    depthIn: 14.5,
    style: 'rail',
    image: novo18Img,
    series: 'Novo',
  },
  {
    id: 'pedaltrain-novo-24',
    brand: 'Pedaltrain',
    name: 'Novo 24',
    widthIn: 24,
    depthIn: 14.5,
    style: 'rail',
    image: novo24Img,
    series: 'Novo',
  },
  {
    id: 'pedaltrain-novo-32',
    brand: 'Pedaltrain',
    name: 'Novo 32',
    widthIn: 32,
    depthIn: 14.5,
    style: 'rail',
    image: novo32Img,
    series: 'Novo',
  },
  // Pedaltrain — Large
  {
    id: 'pedaltrain-terra-42',
    brand: 'Pedaltrain',
    name: 'Terra 42',
    widthIn: 42,
    depthIn: 14.5,
    style: 'rail',
    image: terra42Img,
    series: 'Large',
  },
  {
    id: 'pedaltrain-xd-18',
    brand: 'Pedaltrain',
    name: 'XD-18',
    widthIn: 18,
    depthIn: 17.5,
    style: 'rail',
    image: xd18Img,
    series: 'Large',
  },
  {
    id: 'pedaltrain-xd-24',
    brand: 'Pedaltrain',
    name: 'XD-24',
    widthIn: 24,
    depthIn: 17.5,
    style: 'rail',
    image: xd24Img,
    series: 'Large',
  },
  // Temple Audio — widths are the usable-pedal-area width (marketed
  // model number is slightly larger; e.g. Duo 24 markets as 24" but
  // actually fits pedals across 22.7"). All boards in a series share
  // a fixed depth.
  // Solo
  {
    id: 'temple-solo-18',
    brand: 'Temple Audio',
    name: 'Solo 18',
    widthIn: 16.7,
    depthIn: 8.5,
    style: 'holes',
    series: 'Solo',
  },
  // Duo
  {
    id: 'temple-duo-17',
    brand: 'Temple Audio',
    name: 'Duo 17',
    widthIn: 15.7,
    depthIn: 12.5,
    style: 'holes',
    series: 'Duo',
  },
  {
    id: 'temple-duo-24',
    brand: 'Temple Audio',
    name: 'Duo 24',
    widthIn: 22.7,
    depthIn: 12.5,
    style: 'holes',
    series: 'Duo',
  },
  {
    id: 'temple-duo-34',
    brand: 'Temple Audio',
    name: 'Duo 34',
    widthIn: 32.7,
    depthIn: 12.5,
    style: 'holes',
    series: 'Duo',
  },
  // Trio
  {
    id: 'temple-trio-21',
    brand: 'Temple Audio',
    name: 'Trio 21',
    widthIn: 19.7,
    depthIn: 16.5,
    style: 'holes',
    series: 'Trio',
  },
  {
    id: 'temple-trio-28',
    brand: 'Temple Audio',
    name: 'Trio 28',
    widthIn: 26.7,
    depthIn: 16.5,
    style: 'holes',
    series: 'Trio',
  },
  {
    id: 'temple-trio-43',
    brand: 'Temple Audio',
    name: 'Trio 43',
    widthIn: 41.7,
    depthIn: 16.5,
    style: 'holes',
    series: 'Trio',
  },
];

export function findPreset(id: string): BoardPreset | undefined {
  return BOARD_PRESETS.find((p) => p.id === id);
}

export function presetsByBrand(): Map<string, BoardPreset[]> {
  const byBrand = new Map<string, BoardPreset[]>();
  for (const p of BOARD_PRESETS) {
    const list = byBrand.get(p.brand) ?? [];
    list.push(p);
    byBrand.set(p.brand, list);
  }
  return byBrand;
}

/**
 * Find the Pedaltrain rail preset closest to (widthIn, depthIn) in
 * Euclidean distance. Used so custom-rail rigs get a real photo
 * stretched to fit, instead of the procedural rail drawer. Only
 * Pedaltrain rail presets with bundled images are considered.
 */
export function findClosestRailPreset(
  widthIn: number,
  depthIn: number,
): BoardPreset | undefined {
  let best: BoardPreset | undefined;
  let bestDist = Infinity;
  for (const p of BOARD_PRESETS) {
    if (p.brand !== 'Pedaltrain' || p.style !== 'rail' || !p.image) continue;
    const dw = p.widthIn - widthIn;
    const dd = p.depthIn - depthIn;
    const dist = dw * dw + dd * dd;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

/**
 * Resolve which bundled board image should render for a rig.
 *
 * - If the rig has a presetId pointing at a preset with an image, use that.
 * - Else, if style is 'rail', pick the closest Pedaltrain rail preset by
 *   Euclidean (widthIn, depthIn) distance and let the canvas stretch its
 *   image to fit. Looks better than the procedural rail drawer for any
 *   sane custom dimensions.
 * - Otherwise return null — callers fall back to the procedural drawer.
 */
export function resolveBoardImageSrc(rig: {
  style: BoardStyle;
  presetId: string | null;
  widthIn: number;
  depthIn: number;
}): string | null {
  if (rig.presetId) {
    const preset = findPreset(rig.presetId);
    if (preset?.image) return preset.image;
  }
  if (rig.style === 'rail') {
    const closest = findClosestRailPreset(rig.widthIn, rig.depthIn);
    if (closest?.image) return closest.image;
  }
  return null;
}

/** Pedaltrain presets grouped by series, in the order defined by PEDALTRAIN_SERIES_ORDER. */
export function pedaltrainPresetsBySeries(): Map<BoardSeries, BoardPreset[]> {
  const bySeries = new Map<BoardSeries, BoardPreset[]>();
  for (const series of PEDALTRAIN_SERIES_ORDER) {
    bySeries.set(series, []);
  }
  for (const p of BOARD_PRESETS) {
    if (p.brand !== 'Pedaltrain' || !p.series) continue;
    bySeries.get(p.series)?.push(p);
  }
  return bySeries;
}

/** Temple Audio presets grouped by series, in the order defined by TEMPLE_AUDIO_SERIES_ORDER. */
export function templeAudioPresetsBySeries(): Map<BoardSeries, BoardPreset[]> {
  const bySeries = new Map<BoardSeries, BoardPreset[]>();
  for (const series of TEMPLE_AUDIO_SERIES_ORDER) {
    bySeries.set(series, []);
  }
  for (const p of BOARD_PRESETS) {
    if (p.brand !== 'Temple Audio' || !p.series) continue;
    bySeries.get(p.series)?.push(p);
  }
  return bySeries;
}
