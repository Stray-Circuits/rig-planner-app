/**
 * Floor style — the background painted behind the pedalboard on the rig
 * screen. Stored per-rig in the `rigs` table (see migration 0005); this
 * module owns the catalog of styles and the CSS recipe for the 'custom'
 * style. Was a global localStorage preference until issue #114.
 */

import type { CSSProperties } from 'react';
import type { CustomFloor, FloorStyle } from '../data/schema';

export type { CustomFloor, FloorStyle } from '../data/schema';

export const FLOOR_STYLES: { id: FloorStyle; label: string }[] = [
  { id: 'concrete_grey', label: 'Concrete' },
  { id: 'stage_black', label: 'Stage' },
  { id: 'carpet_beige', label: 'Carpet' },
  { id: 'wood', label: 'Wood' },
  { id: 'sidewalk', label: 'Sidewalk' },
  { id: 'custom', label: 'Custom' },
];

export const DEFAULT_FLOOR_STYLE: FloorStyle = 'concrete_grey';
export const DEFAULT_CUSTOM_FLOOR: CustomFloor = {
  color: '#8a8a8a',
  grain: 0.4,
};

export function isFloorStyle(s: unknown): s is FloorStyle {
  return typeof s === 'string' && FLOOR_STYLES.some((f) => f.id === s);
}

export function isValidHexColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s.trim());
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

/**
 * Legacy localStorage keys for the pre-#114 global floor preference. Read
 * once at app boot by the backfill in `legacyFloorBackfill.ts` and then
 * cleared. Exported so tests can introspect them.
 */
export const LEGACY_FLOOR_STORAGE_KEY = 'rig-planner:floorStyle';
export const LEGACY_CUSTOM_FLOOR_STORAGE_KEY = 'rig-planner:customFloor';
