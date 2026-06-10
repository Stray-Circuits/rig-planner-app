/**
 * Floor style — the background behind the pedalboard on the rig screen.
 * Stored as a global UI preference in localStorage; not per-rig and not
 * synced through the DB. If/when this becomes a per-rig setting we can
 * migrate it into the rigs table.
 */

import type { CSSProperties } from 'react';

export type FloorStyle =
  | 'concrete_grey'
  | 'stage_black'
  | 'carpet_beige'
  | 'wood'
  | 'sidewalk'
  | 'custom';

export const FLOOR_STYLES: { id: FloorStyle; label: string }[] = [
  { id: 'concrete_grey', label: 'Concrete' },
  { id: 'stage_black', label: 'Stage' },
  { id: 'carpet_beige', label: 'Carpet' },
  { id: 'wood', label: 'Wood' },
  { id: 'sidewalk', label: 'Sidewalk' },
  { id: 'custom', label: 'Custom' },
];

/** User-chosen color + grain overlay strength for the 'custom' floor. */
export interface CustomFloor {
  /** Hex color string in #rrggbb form. */
  color: string;
  /** Texture overlay intensity, 0 (solid color) to 1 (full grain). */
  grain: number;
}

const STORAGE_KEY = 'rig-planner:floorStyle';
const CUSTOM_STORAGE_KEY = 'rig-planner:customFloor';
const DEFAULT: FloorStyle = 'concrete_grey';
export const DEFAULT_CUSTOM_FLOOR: CustomFloor = {
  color: '#8a8a8a',
  grain: 0.4,
};

function isFloorStyle(s: string): s is FloorStyle {
  return FLOOR_STYLES.some((f) => f.id === s);
}

export function readFloorStyle(): FloorStyle {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && isFloorStyle(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function writeFloorStyle(style: FloorStyle): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // Quota or private-mode failure — silent; the runtime falls back to
    // the default style on next load.
  }
}

function isValidHex(s: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(s.trim());
}

export function readCustomFloor(): CustomFloor {
  if (typeof window === 'undefined') return DEFAULT_CUSTOM_FLOOR;
  try {
    const raw = window.localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return DEFAULT_CUSTOM_FLOOR;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CUSTOM_FLOOR;
    const obj = parsed as Record<string, unknown>;
    const color =
      typeof obj.color === 'string' && isValidHex(obj.color)
        ? obj.color
        : DEFAULT_CUSTOM_FLOOR.color;
    const grain =
      typeof obj.grain === 'number' && obj.grain >= 0 && obj.grain <= 1
        ? obj.grain
        : DEFAULT_CUSTOM_FLOOR.grain;
    return { color, grain };
  } catch {
    return DEFAULT_CUSTOM_FLOOR;
  }
}

export function writeCustomFloor(custom: CustomFloor): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(custom));
  } catch {
    // Same fallback behavior as writeFloorStyle.
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 136, g: 136, b: 136 };
  const v = parseInt(m[1]!, 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

/**
 * Inline-style background for the 'custom' floor.
 *
 * Three layered backgrounds (painted top → bottom):
 *   1. Solid-color overlay with alpha = 1 - grain. Fully opaque at grain=0
 *      so the user gets a flat color; fully transparent at grain=1 so the
 *      grain shows through.
 *   2. Concrete texture, blended via `multiply` into the base color so the
 *      grain modulates the user's color instead of replacing it.
 *   3. Base color fallback.
 */
export function customFloorBackgroundStyle(custom: CustomFloor): CSSProperties {
  const { r, g, b } = hexToRgb(custom.color);
  const overlayAlpha = Math.max(0, Math.min(1, 1 - custom.grain));
  return {
    background: `linear-gradient(rgba(${r}, ${g}, ${b}, ${overlayAlpha}), rgba(${r}, ${g}, ${b}, ${overlayAlpha})), url('/textures/floors/concrete_grey.jpg') repeat, ${custom.color}`,
    backgroundSize: 'cover, 256px 256px, auto',
    backgroundBlendMode: 'normal, multiply, normal',
  };
}
