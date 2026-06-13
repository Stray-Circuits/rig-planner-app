/**
 * One-shot backfill: the floor style was a global localStorage preference
 * until issue #114; on the first run after migration 0005 we want every
 * existing rig to keep rendering against whatever floor the user had set
 * globally, instead of silently snapping back to the column default.
 *
 * Idempotent via an `app_state` flag — subsequent app boots are a single
 * SELECT and an early return.
 */
import { getDb } from './db';
import {
  DEFAULT_CUSTOM_FLOOR,
  DEFAULT_FLOOR_STYLE,
  LEGACY_CUSTOM_FLOOR_STORAGE_KEY,
  LEGACY_FLOOR_STORAGE_KEY,
  isFloorStyle,
  isValidHexColor,
} from '../lib/floorStyle';
import type { CustomFloor, FloorStyle } from './schema';

const FLAG_KEY = 'floor_per_rig_backfill_v1';

interface LegacySettings {
  floorStyle: FloorStyle;
  customFloor: CustomFloor;
  /** True iff at least one legacy value was actually present in storage. */
  hadAny: boolean;
}

function readLegacyFromStorage(): LegacySettings {
  const fallback: LegacySettings = {
    floorStyle: DEFAULT_FLOOR_STYLE,
    customFloor: DEFAULT_CUSTOM_FLOOR,
    hadAny: false,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const rawStyle = window.localStorage.getItem(LEGACY_FLOOR_STORAGE_KEY);
    const rawCustom = window.localStorage.getItem(
      LEGACY_CUSTOM_FLOOR_STORAGE_KEY,
    );
    const hadAny = rawStyle !== null || rawCustom !== null;
    const floorStyle: FloorStyle = isFloorStyle(rawStyle)
      ? rawStyle
      : DEFAULT_FLOOR_STYLE;
    let customFloor = DEFAULT_CUSTOM_FLOOR;
    if (rawCustom !== null) {
      try {
        const parsed: unknown = JSON.parse(rawCustom);
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          customFloor = {
            color: isValidHexColor(obj.color)
              ? obj.color
              : DEFAULT_CUSTOM_FLOOR.color,
            grain:
              typeof obj.grain === 'number' && obj.grain >= 0 && obj.grain <= 1
                ? obj.grain
                : DEFAULT_CUSTOM_FLOOR.grain,
          };
        }
      } catch {
        // Malformed JSON — fall through with defaults.
      }
    }
    return { floorStyle, customFloor, hadAny };
  } catch {
    return fallback;
  }
}

function clearLegacyFromStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_FLOOR_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_CUSTOM_FLOOR_STORAGE_KEY);
  } catch {
    // Quota / private-mode — harmless, the next boot will hit the flag and skip.
  }
}

/**
 * Run the backfill if it hasn't already. Safe to call on every boot; the
 * `app_state` flag short-circuits subsequent runs, and the in-flight
 * promise guard short-circuits concurrent calls within a single boot
 * (React StrictMode runs the boot effect twice in dev, which used to
 * race two backfills into a UNIQUE-constraint failure on the flag INSERT).
 */
let inFlight: Promise<void> | null = null;

export function ensureLegacyFloorBackfill(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runBackfill().catch((err: unknown) => {
    // Don't pin a failed attempt — the next boot should try again.
    inFlight = null;
    throw err;
  });
  return inFlight;
}

async function runBackfill(): Promise<void> {
  const db = await getDb();
  const flagRows = await db.select<{ value: string | null | undefined }>(
    `SELECT value FROM app_state WHERE key = ?`,
    [FLAG_KEY],
  );
  if (flagRows.length > 0) return;

  const legacy = readLegacyFromStorage();
  // Even when no legacy value exists (fresh install) we still want to set
  // the flag so we don't run the SELECT on every future boot.
  if (legacy.hadAny) {
    const rigRows = await db.select<{ id: string }>('SELECT id FROM rigs');
    for (const row of rigRows) {
      // Intentionally NOT bumping `updated_at` — the rig list orders by it,
      // so touching every row would collapse the user's recent-use sort
      // into a single timestamp on first launch post-upgrade.
      await db.execute(
        `UPDATE rigs SET floor_style = ?, custom_floor_color = ?, custom_floor_grain = ?
         WHERE id = ?`,
        [
          legacy.floorStyle,
          legacy.customFloor.color,
          legacy.customFloor.grain,
          row.id,
        ],
      );
    }
  }

  await db.execute(`INSERT INTO app_state (key, value) VALUES (?, ?)`, [
    FLAG_KEY,
    '1',
  ]);
  clearLegacyFromStorage();
}
