/**
 * File-based rig sharing & backup format (`.rig.json`).
 *
 * One rig per file: the rig row, every pedal the rig places, the placements
 * themselves, the external endpoints, and the connections. Pedal images are
 * already embedded in `Pedal.imagePath` as data URLs (or `color:#RRGGBB`
 * placeholders), so the file is self-contained — no asset sync needed.
 *
 * This module is pure: no DB, no DOM. Use {@link buildRigExport} to
 * serialize and {@link parseRigExport} to validate incoming files. The
 * actual write-to-DB side of import lives in `rigImportRepo.ts`.
 */
import type {
  Connection,
  ExternalEndpoint,
  Pedal,
  PlacedPedal,
  Rig,
} from '../data/schema';

export const RIG_EXPORT_KIND = 'rig-planner-export' as const;
export const RIG_EXPORT_VERSION = 1 as const;

export interface RigExport {
  kind: typeof RIG_EXPORT_KIND;
  version: number;
  exportedAt: string;
  rig: Rig;
  pedals: Pedal[];
  placedPedals: PlacedPedal[];
  externalEndpoints: ExternalEndpoint[];
  connections: Connection[];
}

export interface BuildRigExportInput {
  rig: Rig;
  /** Full pedal library — only those referenced by `placedPedals` are kept. */
  pedals: Pedal[];
  placedPedals: PlacedPedal[];
  endpoints: ExternalEndpoint[];
  connections: Connection[];
  exportedAt?: string;
}

export function buildRigExport(input: BuildRigExportInput): RigExport {
  const referenced = new Set(input.placedPedals.map((p) => p.pedalId));
  const pedals = input.pedals.filter((p) => referenced.has(p.id));
  return {
    kind: RIG_EXPORT_KIND,
    version: RIG_EXPORT_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    rig: input.rig,
    pedals,
    placedPedals: input.placedPedals,
    externalEndpoints: input.endpoints,
    connections: input.connections,
  };
}

/**
 * Default filename for an exported rig. Sanitises the rig name to be safe on
 * macOS / Windows / Linux filesystems and tacks on a short date so successive
 * exports don't clobber each other in the user's downloads folder.
 */
export function defaultExportFilename(rig: Pick<Rig, 'name'>): string {
  const safe = rig.name
    .trim()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stem = safe.length > 0 ? safe : 'rig';
  const date = new Date().toISOString().slice(0, 10);
  return `${stem}-${date}.rig.json`;
}

class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RigImportError';
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new ImportError(`Missing or invalid field: ${key}`);
  }
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ImportError(`Missing or invalid number field: ${key}`);
  }
  return v;
}

function requireArray(obj: Record<string, unknown>, key: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) {
    throw new ImportError(`Missing or invalid array field: ${key}`);
  }
  return v;
}

/**
 * Validate that `text` is a well-formed rig export. Throws a friendly error
 * message if it's not. Performs structural checks only — referential
 * integrity (do placedPedals match a pedal in the file? do connections
 * point at real ports?) is the importer's job.
 */
export function parseRigExport(text: string): RigExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('File is not valid JSON.');
  }
  if (!isObject(raw)) {
    throw new ImportError('File does not contain a rig export object.');
  }
  const kind = requireString(raw, 'kind');
  if (kind !== RIG_EXPORT_KIND) {
    throw new ImportError(
      `Unsupported file kind "${kind}" — expected "${RIG_EXPORT_KIND}".`,
    );
  }
  const version = requireNumber(raw, 'version');
  if (version !== RIG_EXPORT_VERSION) {
    throw new ImportError(
      `Unsupported export version ${version} (this build expects ${RIG_EXPORT_VERSION}).`,
    );
  }
  const exportedAt = requireString(raw, 'exportedAt');

  if (!isObject(raw.rig)) throw new ImportError('Missing rig.');
  const rigObj = raw.rig;
  // Spot-check rig fields so a malformed payload fails here instead of
  // partway through a DB write.
  requireString(rigObj, 'id');
  requireString(rigObj, 'name');
  requireNumber(rigObj, 'widthIn');
  requireNumber(rigObj, 'depthIn');
  requireString(rigObj, 'style');
  // presetId is optional in older exports — coerce missing/invalid to null
  // so downstream code can treat it as Rig['presetId'] without runtime
  // surprises.
  const presetIdRaw = rigObj.presetId;
  const presetId: string | null =
    typeof presetIdRaw === 'string' ? presetIdRaw : null;
  // jackSize is optional in older exports — default to the conservative
  // 'large' size when missing so existing rigs keep their previous
  // keep-out spacing.
  const jackSizeRaw = rigObj.jackSize;
  const jackSize: Rig['jackSize'] =
    jackSizeRaw === 'small' ||
    jackSizeRaw === 'medium' ||
    jackSizeRaw === 'large'
      ? jackSizeRaw
      : 'large';
  const rig = { ...rigObj, presetId, jackSize } as unknown as Rig;

  const pedals = requireArray(raw, 'pedals') as Pedal[];
  const placedPedals = requireArray(raw, 'placedPedals') as PlacedPedal[];
  const externalEndpoints = requireArray(
    raw,
    'externalEndpoints',
  ) as ExternalEndpoint[];
  const connections = requireArray(raw, 'connections') as Connection[];

  return {
    kind: RIG_EXPORT_KIND,
    version,
    exportedAt,
    rig,
    pedals,
    placedPedals,
    externalEndpoints,
    connections,
  };
}

export { ImportError as RigImportError };
