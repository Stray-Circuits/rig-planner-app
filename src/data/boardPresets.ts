import type { BoardStyle } from './schema';

export interface BoardPreset {
  id: string;
  brand: string;
  name: string;
  widthIn: number;
  depthIn: number;
  style: BoardStyle;
}

export const BOARD_PRESETS: readonly BoardPreset[] = [
  {
    id: 'pedaltrain-nano-plus',
    brand: 'Pedaltrain',
    name: 'Nano+',
    widthIn: 18,
    depthIn: 5,
    style: 'rail',
  },
  {
    id: 'pedaltrain-metro-24',
    brand: 'Pedaltrain',
    name: 'Metro 24',
    widthIn: 24,
    depthIn: 8,
    style: 'rail',
  },
  {
    id: 'pedaltrain-classic-pro',
    brand: 'Pedaltrain',
    name: 'Classic Pro',
    widthIn: 32,
    depthIn: 16,
    style: 'rail',
  },
  {
    id: 'temple-solo-18',
    brand: 'Temple Audio',
    name: 'Solo 18',
    widthIn: 16.7,
    depthIn: 8.5,
    style: 'holes',
  },
  {
    id: 'temple-duo-24',
    brand: 'Temple Audio',
    name: 'Duo 24',
    widthIn: 23.2,
    depthIn: 12.5,
    style: 'holes',
  },
  {
    id: 'temple-trio-21',
    brand: 'Temple Audio',
    name: 'Trio 21',
    widthIn: 19.7,
    depthIn: 16.5,
    style: 'holes',
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
