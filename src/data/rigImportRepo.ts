/**
 * Applies a parsed {@link RigExport} to the database, replacing any matching
 * rig in place. Port IDs from the export are preserved verbatim so the
 * file's `connections` rows continue to point at the right ports after
 * import — this means an existing pedal with the same ID on the receiving
 * side has its ports clobbered (the file is authoritative).
 */
import { getDb } from './db';
import { getRig } from './rigsRepo';
import type { Pedal } from './schema';
import type { RigExport } from '../lib/rigPortability';

export interface ImportRigResult {
  /** True when a rig with the same ID already existed and was overwritten. */
  replaced: boolean;
  /** Whether the file referenced a pre-existing rig at all (mirrors `replaced` today). */
  rigId: string;
}

/**
 * Check whether the export's rig ID collides with an existing rig. Used by
 * the UI to show a confirmation dialog before calling {@link importRig}.
 */
export async function findExistingRigForImport(
  exp: RigExport,
): Promise<{ id: string; name: string } | null> {
  const existing = await getRig(exp.rig.id);
  if (!existing) return null;
  return { id: existing.id, name: existing.name };
}

async function upsertPedalForImport(pedal: Pedal): Promise<void> {
  const db = await getDb();
  const existing = await db.select<{ id: string }>(
    'SELECT id FROM pedals WHERE id = ?',
    [pedal.id],
  );
  const pedalFields: [
    string,
    string,
    number,
    number,
    string | null,
    string | null,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    string | null,
  ] = [
    pedal.brand,
    pedal.name,
    pedal.widthIn,
    pedal.depthIn,
    pedal.imagePath ?? null,
    pedal.imageSourceUrl ?? null,
    pedal.jackSides.top ? 1 : 0,
    pedal.jackSides.bottom ? 1 : 0,
    pedal.jackSides.left ? 1 : 0,
    pedal.jackSides.right ? 1 : 0,
    pedal.jackSides.midi_top ? 1 : 0,
    pedal.jackSides.midi_bottom ? 1 : 0,
    pedal.jackSides.midi_left ? 1 : 0,
    pedal.jackSides.midi_right ? 1 : 0,
    pedal.powerSide ?? null,
  ];

  if (existing.length > 0) {
    await db.execute(
      `UPDATE pedals SET
         brand = ?, name = ?, width_in = ?, depth_in = ?, image_path = ?, image_source_url = ?,
         jack_top = ?, jack_bottom = ?, jack_left = ?, jack_right = ?,
         midi_top = ?, midi_bottom = ?, midi_left = ?, midi_right = ?,
         power_side = ?
       WHERE id = ?`,
      [...pedalFields, pedal.id],
    );
    // Wipe existing ports so we can replay the export's ports with their
    // original IDs. Connections in the export reference these IDs, so
    // preserving them is what makes the imported rig render correctly.
    const oldPorts = await db.select<{ id: string }>(
      'SELECT id FROM ports WHERE pedal_id = ?',
      [pedal.id],
    );
    for (const row of oldPorts) {
      await db.execute('DELETE FROM ports WHERE id = ?', [row.id]);
    }
  } else {
    await db.execute(
      `INSERT INTO pedals (
        id, brand, name, width_in, depth_in, image_path, image_source_url,
        jack_top, jack_bottom, jack_left, jack_right,
        midi_top, midi_bottom, midi_left, midi_right,
        power_side
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pedal.id, ...pedalFields],
    );
  }

  for (const port of pedal.ports) {
    await db.execute(
      `INSERT INTO ports (
        id, pedal_id, label, role, signal_type, connector, side, side_order, optional
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        port.id,
        pedal.id,
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

async function clearRigChildren(rigId: string): Promise<void> {
  const db = await getDb();
  const placed = await db.select<{ id: string }>(
    'SELECT id FROM placed_pedals WHERE rig_id = ?',
    [rigId],
  );
  for (const row of placed) {
    await db.execute('DELETE FROM placed_pedals WHERE id = ?', [row.id]);
  }
  const endpoints = await db.select<{ id: string }>(
    'SELECT id FROM external_endpoints WHERE rig_id = ?',
    [rigId],
  );
  for (const row of endpoints) {
    await db.execute('DELETE FROM external_endpoints WHERE id = ?', [row.id]);
  }
  const conns = await db.select<{ id: string }>(
    'SELECT id FROM connections WHERE rig_id = ?',
    [rigId],
  );
  for (const row of conns) {
    await db.execute('DELETE FROM connections WHERE id = ?', [row.id]);
  }
}

export async function importRig(exp: RigExport): Promise<ImportRigResult> {
  const db = await getDb();
  const existing = await getRig(exp.rig.id);

  // Upsert all referenced pedals first so placed_pedals' FK is satisfied
  // under the SQLite build.
  for (const pedal of exp.pedals) {
    await upsertPedalForImport(pedal);
  }

  if (existing) {
    await clearRigChildren(exp.rig.id);
    await db.execute(
      `UPDATE rigs SET name = ?, width_in = ?, depth_in = ?, style = ?, preset_id = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        exp.rig.name,
        exp.rig.widthIn,
        exp.rig.depthIn,
        exp.rig.style,
        exp.rig.presetId ?? null,
        exp.rig.id,
      ],
    );
  } else {
    await db.execute(
      `INSERT INTO rigs (id, name, width_in, depth_in, style, preset_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        exp.rig.id,
        exp.rig.name,
        exp.rig.widthIn,
        exp.rig.depthIn,
        exp.rig.style,
        exp.rig.presetId ?? null,
      ],
    );
  }

  for (const placed of exp.placedPedals) {
    await db.execute(
      `INSERT INTO placed_pedals (id, rig_id, pedal_id, x_in, y_in, rotation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        placed.id,
        exp.rig.id,
        placed.pedalId,
        placed.xIn,
        placed.yIn,
        placed.rotation,
      ],
    );
  }
  for (const ep of exp.externalEndpoints) {
    await db.execute(
      `INSERT INTO external_endpoints (id, rig_id, kind, label)
       VALUES (?, ?, ?, ?)`,
      [ep.id, exp.rig.id, ep.kind, ep.label],
    );
  }
  for (const c of exp.connections) {
    await db.execute(
      `INSERT INTO connections (id, rig_id, from_node_kind, from_node_id, from_port_id,
                                to_node_kind, to_node_id, to_port_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        c.id,
        exp.rig.id,
        c.fromNodeKind,
        c.fromNodeId,
        c.fromPortId,
        c.toNodeKind,
        c.toNodeId,
        c.toPortId,
      ],
    );
  }

  return { replaced: existing !== null, rigId: exp.rig.id };
}
