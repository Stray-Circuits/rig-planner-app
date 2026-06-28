import { getDb } from './db';
import type {
  Connector,
  JackSides,
  Pedal,
  Port,
  PortRole,
  Side,
  SignalType,
} from './schema';
import { newId } from '../lib/ids';

interface PedalRow {
  id: string;
  brand: string;
  name: string;
  width_in: number;
  depth_in: number;
  image_path: string | null;
  image_source_url: string | null;
  jack_top: number;
  jack_bottom: number;
  jack_left: number;
  jack_right: number;
  midi_top: number;
  midi_bottom: number;
  midi_left: number;
  midi_right: number;
  power_side: string | null;
  created_at: string;
  updated_at: string;
}

interface PortRow {
  id: string;
  pedal_id: string;
  label: string;
  role: string;
  signal_type: string;
  connector: string;
  side: string;
  side_order: number;
  optional: number;
}

const VALID_SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];
const VALID_ROLES: readonly PortRole[] = [
  'input',
  'output',
  'input_l',
  'input_r',
  'stereo_input',
  'output_l',
  'output_r',
  'stereo_output',
  'fx_send',
  'fx_return',
  'midi_in',
  'midi_out',
  'expression_in',
  'expression_out',
  'remote_in',
  'remote_out',
  'cv_in',
  'cv_out',
];

// Legacy direction-less control roles → input variants. Pedals saved
// before the direction split (issue #46) used these undirected names;
// the overwhelming majority of in-the-wild "expression / remote / cv"
// jacks on pedals are inputs (you plug an expression pedal *into* a
// delay's EXP jack), so mapping the legacy values to the *_in variant
// matches user intent for almost all existing data.
const LEGACY_ROLE_ALIASES: Record<string, PortRole> = {
  expression: 'expression_in',
  remote: 'remote_in',
  cv: 'cv_in',
};
const VALID_SIGNAL: readonly SignalType[] = [
  'instrument',
  'line',
  'line_balanced',
  'stereo',
  'amp_level',
  'midi',
  'cv',
  'expression',
  'remote',
];
const VALID_CONN: readonly Connector[] = [
  'ts',
  'trs',
  'xlr',
  'midi_din',
  'midi_trs',
];

function assertSide(s: string): Side {
  if ((VALID_SIDES as readonly string[]).includes(s)) return s as Side;
  throw new Error(`Unknown side "${s}"`);
}
function assertRole(s: string): PortRole {
  if ((VALID_ROLES as readonly string[]).includes(s)) return s as PortRole;
  const aliased = LEGACY_ROLE_ALIASES[s];
  if (aliased) return aliased;
  throw new Error(`Unknown port role "${s}"`);
}
function assertSignal(s: string): SignalType {
  if ((VALID_SIGNAL as readonly string[]).includes(s)) return s as SignalType;
  throw new Error(`Unknown signal type "${s}"`);
}
function assertConn(s: string): Connector {
  if ((VALID_CONN as readonly string[]).includes(s)) return s as Connector;
  throw new Error(`Unknown connector "${s}"`);
}

function pedalFromRow(row: PedalRow, ports: Port[]): Pedal {
  const jackSides: JackSides = {
    top: !!row.jack_top,
    bottom: !!row.jack_bottom,
    left: !!row.jack_left,
    right: !!row.jack_right,
    midi_top: !!row.midi_top,
    midi_bottom: !!row.midi_bottom,
    midi_left: !!row.midi_left,
    midi_right: !!row.midi_right,
  };
  return {
    id: row.id,
    brand: row.brand,
    name: row.name,
    widthIn: row.width_in,
    depthIn: row.depth_in,
    imagePath: row.image_path,
    imageSourceUrl: row.image_source_url ?? null,
    jackSides,
    powerSide: row.power_side ? assertSide(row.power_side) : null,
    ports,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function portFromRow(row: PortRow): Port {
  return {
    id: row.id,
    pedalId: row.pedal_id,
    label: row.label,
    role: assertRole(row.role),
    signalType: assertSignal(row.signal_type),
    connector: assertConn(row.connector),
    side: assertSide(row.side),
    sideOrder: row.side_order,
    optional: !!row.optional,
  };
}

export interface CreatePedalInput {
  id?: string;
  brand: string;
  name: string;
  widthIn: number;
  depthIn: number;
  imagePath?: string | null;
  imageSourceUrl?: string | null;
  jackSides: JackSides;
  powerSide?: Side | null;
  // `id` is optional: present for ports that already exist (so an edit can
  // reconcile them by identity), absent for ports being added for the first
  // time (createPedal / updatePedal generate one).
  ports: (Omit<Port, 'id' | 'pedalId'> & { id?: string })[];
}

export async function listPedals(): Promise<Pedal[]> {
  const db = await getDb();
  const pedalRows = await db.select<PedalRow>(
    'SELECT * FROM pedals ORDER BY brand ASC',
  );
  if (pedalRows.length === 0) return [];
  const result: Pedal[] = [];
  for (const row of pedalRows) {
    const portRows = await db.select<PortRow>(
      'SELECT * FROM ports WHERE pedal_id = ?',
      [row.id],
    );
    const ports = portRows
      .map(portFromRow)
      .sort((a, b) => a.sideOrder - b.sideOrder);
    result.push(pedalFromRow(row, ports));
  }
  // Stable secondary sort by name within brand
  return result.sort((a, b) => {
    if (a.brand !== b.brand) return a.brand < b.brand ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  });
}

export async function getPedal(id: string): Promise<Pedal | null> {
  const db = await getDb();
  const rows = await db.select<PedalRow>('SELECT * FROM pedals WHERE id = ?', [
    id,
  ]);
  const row = rows[0];
  if (!row) return null;
  const portRows = await db.select<PortRow>(
    'SELECT * FROM ports WHERE pedal_id = ?',
    [id],
  );
  const ports = portRows
    .map(portFromRow)
    .sort((a, b) => a.sideOrder - b.sideOrder);
  return pedalFromRow(row, ports);
}

export async function createPedal(input: CreatePedalInput): Promise<Pedal> {
  const id = input.id ?? newId();
  const db = await getDb();
  await db.execute(
    `INSERT INTO pedals (
      id, brand, name, width_in, depth_in, image_path, image_source_url,
      jack_top, jack_bottom, jack_left, jack_right,
      midi_top, midi_bottom, midi_left, midi_right,
      power_side
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.brand,
      input.name,
      input.widthIn,
      input.depthIn,
      input.imagePath ?? null,
      input.imageSourceUrl ?? null,
      input.jackSides.top ? 1 : 0,
      input.jackSides.bottom ? 1 : 0,
      input.jackSides.left ? 1 : 0,
      input.jackSides.right ? 1 : 0,
      input.jackSides.midi_top ? 1 : 0,
      input.jackSides.midi_bottom ? 1 : 0,
      input.jackSides.midi_left ? 1 : 0,
      input.jackSides.midi_right ? 1 : 0,
      input.powerSide ?? null,
    ],
  );
  for (const port of input.ports) {
    await db.execute(
      `INSERT INTO ports (
        id, pedal_id, label, role, signal_type, connector, side, side_order, optional
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        port.id ?? newId(),
        id,
        port.label,
        port.role,
        port.signalType,
        port.connector,
        port.side,
        port.sideOrder,
        port.optional ? 1 : 0,
      ],
    );
  }
  const created = await getPedal(id);
  if (!created) throw new Error('Pedal insert succeeded but row not found');
  return created;
}

export type UpdatePedalInput = Omit<CreatePedalInput, 'id'>;

/**
 * Update a pedal in place. Pedal fields are overwritten; ports are
 * reconciled by matching `(role, label)` between the old and new
 * lists so existing connections (which reference port_id) survive as
 * long as the user didn't remove or rename a port.
 *
 * Returned: the fresh pedal + the set of port_ids that disappeared.
 * Callers can use the removed set to clean up cables referencing them.
 */
export async function updatePedal(
  id: string,
  input: UpdatePedalInput,
): Promise<{ pedal: Pedal; removedPortIds: string[] }> {
  const db = await getDb();

  await db.execute(
    `UPDATE pedals SET
       brand = ?, name = ?, width_in = ?, depth_in = ?, image_path = ?, image_source_url = ?,
       jack_top = ?, jack_bottom = ?, jack_left = ?, jack_right = ?,
       midi_top = ?, midi_bottom = ?, midi_left = ?, midi_right = ?,
       power_side = ?
     WHERE id = ?`,
    [
      input.brand,
      input.name,
      input.widthIn,
      input.depthIn,
      input.imagePath ?? null,
      input.imageSourceUrl ?? null,
      input.jackSides.top ? 1 : 0,
      input.jackSides.bottom ? 1 : 0,
      input.jackSides.left ? 1 : 0,
      input.jackSides.right ? 1 : 0,
      input.jackSides.midi_top ? 1 : 0,
      input.jackSides.midi_bottom ? 1 : 0,
      input.jackSides.midi_left ? 1 : 0,
      input.jackSides.midi_right ? 1 : 0,
      input.powerSide ?? null,
      id,
    ],
  );

  // Pull existing ports and match by stable port id. A port carrying an id
  // that still exists is updated in place (preserving its cables); a port
  // with no id — or an id that's gone — is inserted as new. Anything left
  // over on the OLD side is deleted. Matching by id (not by role+label) lets
  // a pedal keep multiple same-labeled ports (e.g. two FX loops) and keeps a
  // renamed port's identity, so its cables survive (#124).
  const existingRows = await db.select<PortRow>(
    'SELECT * FROM ports WHERE pedal_id = ?',
    [id],
  );
  const oldById = new Map<string, PortRow>();
  for (const row of existingRows) {
    oldById.set(row.id, row);
  }

  const matchedIds = new Set<string>();
  for (const port of input.ports) {
    const existing = port.id ? oldById.get(port.id) : undefined;
    if (existing) {
      await db.execute(
        `UPDATE ports SET label = ?, role = ?, signal_type = ?, connector = ?, side = ?, side_order = ?, optional = ?
         WHERE id = ?`,
        [
          port.label,
          port.role,
          port.signalType,
          port.connector,
          port.side,
          port.sideOrder,
          port.optional ? 1 : 0,
          existing.id,
        ],
      );
      matchedIds.add(existing.id);
    } else {
      await db.execute(
        `INSERT INTO ports (
          id, pedal_id, label, role, signal_type, connector, side, side_order, optional
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          port.id ?? newId(),
          id,
          port.label,
          port.role,
          port.signalType,
          port.connector,
          port.side,
          port.sideOrder,
          port.optional ? 1 : 0,
        ],
      );
    }
  }

  const removedPortIds: string[] = [];
  for (const row of existingRows) {
    if (matchedIds.has(row.id)) continue;
    await db.execute('DELETE FROM ports WHERE id = ?', [row.id]);
    removedPortIds.push(row.id);
  }

  // Drop any cables that referenced the removed ports so the chain
  // doesn't keep dangling references that can't render.
  for (const portId of removedPortIds) {
    const conns = await db.select<{ id: string }>(
      'SELECT id FROM connections WHERE from_port_id = ?',
      [portId],
    );
    for (const c of conns) {
      await db.execute('DELETE FROM connections WHERE id = ?', [c.id]);
    }
    const conns2 = await db.select<{ id: string }>(
      'SELECT id FROM connections WHERE to_port_id = ?',
      [portId],
    );
    for (const c of conns2) {
      await db.execute('DELETE FROM connections WHERE id = ?', [c.id]);
    }
  }

  const fresh = await getPedal(id);
  if (!fresh) throw new Error('updatePedal: row not found after update');
  return { pedal: fresh, removedPortIds };
}

/**
 * Returns the set of rig ids that currently have a placed instance of this
 * pedal. Used to warn the user before destroying placements.
 */
export async function pedalUsage(id: string): Promise<{ rigIds: string[] }> {
  const db = await getDb();
  const rows = await db.select<{ rig_id: string }>(
    'SELECT rig_id FROM placed_pedals WHERE pedal_id = ?',
    [id],
  );
  const seen = new Set<string>();
  for (const r of rows) seen.add(r.rig_id);
  return { rigIds: [...seen] };
}

export async function deletePedal(id: string): Promise<{
  removedPlaced: string[];
  affectedRigIds: string[];
}> {
  const db = await getDb();

  // Find every placement of this pedal across all rigs so we can clean up
  // their connections first (placed_pedals has ON DELETE RESTRICT in SQL,
  // and the memory adapter doesn't enforce FKs but we'd otherwise leave
  // orphan rows).
  const placed = await db.select<{ id: string; rig_id: string }>(
    'SELECT id, rig_id FROM placed_pedals WHERE pedal_id = ?',
    [id],
  );

  for (const p of placed) {
    const fromConns = await db.select<{ id: string }>(
      'SELECT id FROM connections WHERE from_node_id = ?',
      [p.id],
    );
    for (const c of fromConns) {
      await db.execute('DELETE FROM connections WHERE id = ?', [c.id]);
    }
    const toConns = await db.select<{ id: string }>(
      'SELECT id FROM connections WHERE to_node_id = ?',
      [p.id],
    );
    for (const c of toConns) {
      await db.execute('DELETE FROM connections WHERE id = ?', [c.id]);
    }
    await db.execute('DELETE FROM placed_pedals WHERE id = ?', [p.id]);
  }

  // CASCADE handles the ports table for the pedal row itself.
  await db.execute('DELETE FROM pedals WHERE id = ?', [id]);

  const affectedRigIds = [...new Set(placed.map((p) => p.rig_id))];
  return {
    removedPlaced: placed.map((p) => p.id),
    affectedRigIds,
  };
}
