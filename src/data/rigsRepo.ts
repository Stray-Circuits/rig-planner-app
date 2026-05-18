import { getDb } from './db';
import type { BoardStyle, Rig } from './schema';
import { newId } from '../lib/ids';

interface RigRow {
  id: string;
  name: string;
  width_in: number;
  depth_in: number;
  style: string;
  created_at: string;
  updated_at: string;
}

const VALID_STYLES: readonly BoardStyle[] = ['rail', 'plain', 'wood', 'holes'];

function isStyle(s: string): s is BoardStyle {
  return (VALID_STYLES as readonly string[]).includes(s);
}

function fromRow(r: RigRow): Rig {
  if (!isStyle(r.style)) {
    throw new Error(`Unknown board style "${r.style}" for rig ${r.id}`);
  }
  return {
    id: r.id,
    name: r.name,
    widthIn: r.width_in,
    depthIn: r.depth_in,
    style: r.style,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CreateRigInput {
  name: string;
  widthIn: number;
  depthIn: number;
  style: BoardStyle;
}

export async function listRigs(): Promise<Rig[]> {
  const db = await getDb();
  const rows = await db.select<RigRow>(
    'SELECT * FROM rigs ORDER BY updated_at DESC',
  );
  return rows.map(fromRow);
}

export async function getRig(id: string): Promise<Rig | null> {
  const db = await getDb();
  const rows = await db.select<RigRow>('SELECT * FROM rigs WHERE id = ?', [id]);
  const row = rows[0];
  return row ? fromRow(row) : null;
}

export async function createRig(input: CreateRigInput): Promise<Rig> {
  const name = input.name.trim();
  if (!name) throw new Error('Rig name cannot be empty');
  if (input.widthIn <= 0 || input.depthIn <= 0) {
    throw new Error('Rig dimensions must be positive');
  }
  const id = newId();
  const db = await getDb();
  await db.execute(
    `INSERT INTO rigs (id, name, width_in, depth_in, style)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name, input.widthIn, input.depthIn, input.style],
  );
  const created = await getRig(id);
  if (!created) throw new Error('Rig insert succeeded but row not found');
  return created;
}

export async function renameRig(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Rig name cannot be empty');
  const db = await getDb();
  await db.execute(
    `UPDATE rigs SET name = ?, updated_at = datetime('now') WHERE id = ?`,
    [trimmed, id],
  );
}

export async function updateRigStyle(
  id: string,
  style: BoardStyle,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE rigs SET style = ?, updated_at = datetime('now') WHERE id = ?`,
    [style, id],
  );
}

export async function updateRigDimensions(
  id: string,
  widthIn: number,
  depthIn: number,
): Promise<void> {
  if (widthIn <= 0 || depthIn <= 0) {
    throw new Error('Rig dimensions must be positive');
  }
  const db = await getDb();
  await db.execute(
    `UPDATE rigs SET width_in = ?, depth_in = ?, updated_at = datetime('now') WHERE id = ?`,
    [widthIn, depthIn, id],
  );
}

export async function duplicateRig(id: string): Promise<Rig> {
  const source = await getRig(id);
  if (!source) throw new Error(`Rig ${id} not found`);
  const newRigId = newId();
  const db = await getDb();
  await db.execute(
    `INSERT INTO rigs (id, name, width_in, depth_in, style)
     VALUES (?, ?, ?, ?, ?)`,
    [
      newRigId,
      `${source.name} (copy)`,
      source.widthIn,
      source.depthIn,
      source.style,
    ],
  );
  // Copy placed pedals, external endpoints, connections. IDs are remapped
  // so that connections still point at the right new rows.
  const placedRows = await db.select<{
    id: string;
    pedal_id: string;
    x_in: number;
    y_in: number;
    rotation: number;
  }>(
    `SELECT id, pedal_id, x_in, y_in, rotation FROM placed_pedals WHERE rig_id = ?`,
    [id],
  );
  const placedIdMap = new Map<string, string>();
  for (const row of placedRows) {
    const fresh = newId();
    placedIdMap.set(row.id, fresh);
    await db.execute(
      `INSERT INTO placed_pedals (id, rig_id, pedal_id, x_in, y_in, rotation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fresh, newRigId, row.pedal_id, row.x_in, row.y_in, row.rotation],
    );
  }
  const endpointRows = await db.select<{
    id: string;
    kind: string;
    label: string;
  }>(`SELECT id, kind, label FROM external_endpoints WHERE rig_id = ?`, [id]);
  const endpointIdMap = new Map<string, string>();
  for (const row of endpointRows) {
    const fresh = newId();
    endpointIdMap.set(row.id, fresh);
    await db.execute(
      `INSERT INTO external_endpoints (id, rig_id, kind, label)
       VALUES (?, ?, ?, ?)`,
      [fresh, newRigId, row.kind, row.label],
    );
  }
  const connRows = await db.select<{
    from_node_kind: string;
    from_node_id: string;
    from_port_id: string | null;
    to_node_kind: string;
    to_node_id: string;
    to_port_id: string | null;
  }>(
    `SELECT from_node_kind, from_node_id, from_port_id,
            to_node_kind, to_node_id, to_port_id
     FROM connections WHERE rig_id = ?`,
    [id],
  );
  for (const row of connRows) {
    const remap = (kind: string, id: string): string =>
      kind === 'pedal'
        ? (placedIdMap.get(id) ?? id)
        : (endpointIdMap.get(id) ?? id);
    await db.execute(
      `INSERT INTO connections (id, rig_id, from_node_kind, from_node_id, from_port_id,
                                to_node_kind, to_node_id, to_port_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        newRigId,
        row.from_node_kind,
        remap(row.from_node_kind, row.from_node_id),
        row.from_port_id,
        row.to_node_kind,
        remap(row.to_node_kind, row.to_node_id),
        row.to_port_id,
      ],
    );
  }
  const created = await getRig(newRigId);
  if (!created) throw new Error('Duplicate succeeded but row not found');
  return created;
}

export async function deleteRig(id: string): Promise<void> {
  const db = await getDb();
  // CASCADE handles placed_pedals, external_endpoints, connections.
  await db.execute('DELETE FROM rigs WHERE id = ?', [id]);
}

export async function touchRig(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE rigs SET updated_at = datetime('now') WHERE id = ?`,
    [id],
  );
}
