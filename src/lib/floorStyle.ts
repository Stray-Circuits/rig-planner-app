/**
 * Floor style — the background behind the pedalboard on the rig screen.
 * Stored as a global UI preference in localStorage; not per-rig and not
 * synced through the DB. If/when this becomes a per-rig setting we can
 * migrate it into the rigs table.
 */

export type FloorStyle =
  | 'concrete_grey'
  | 'stage_black'
  | 'carpet_beige'
  | 'wood'
  | 'sidewalk';

export const FLOOR_STYLES: { id: FloorStyle; label: string }[] = [
  { id: 'concrete_grey', label: 'Concrete' },
  { id: 'stage_black', label: 'Stage' },
  { id: 'carpet_beige', label: 'Carpet' },
  { id: 'wood', label: 'Wood' },
  { id: 'sidewalk', label: 'Sidewalk' },
];

const STORAGE_KEY = 'rig-planner:floorStyle';
const DEFAULT: FloorStyle = 'concrete_grey';

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
