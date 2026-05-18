import { getDb } from './db';
import type { PlacedPedal } from './schema';
import { newId } from '../lib/ids';

interface PlacedRow {
  id: string;
  rig_id: string;
  pedal_id: string;
  x_in: number;
  y_in: number;
  rotation: number;
}

function rotationFromInt(n: number): PlacedPedal['rotation'] {
  switch (n) {
    case 0:
    case 90:
    case 180:
    case 270:
      return n;
    default:
      return 0;
  }
}

function fromRow(row: PlacedRow): PlacedPedal {
  return {
    id: row.id,
    rigId: row.rig_id,
    pedalId: row.pedal_id,
    xIn: row.x_in,
    yIn: row.y_in,
    rotation: rotationFromInt(row.rotation),
  };
}

export async function listPlacedPedals(rigId: string): Promise<PlacedPedal[]> {
  const db = await getDb();
  const rows = await db.select<PlacedRow>(
    'SELECT * FROM placed_pedals WHERE rig_id = ?',
    [rigId],
  );
  return rows.map(fromRow);
}

export interface PlacePedalInput {
  rigId: string;
  pedalId: string;
  xIn: number;
  yIn: number;
  rotation?: PlacedPedal['rotation'];
}

export async function placePedal(input: PlacePedalInput): Promise<PlacedPedal> {
  const id = newId();
  const db = await getDb();
  await db.execute(
    `INSERT INTO placed_pedals (id, rig_id, pedal_id, x_in, y_in, rotation)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.rigId, input.pedalId, input.xIn, input.yIn, input.rotation ?? 0],
  );
  return {
    id,
    rigId: input.rigId,
    pedalId: input.pedalId,
    xIn: input.xIn,
    yIn: input.yIn,
    rotation: input.rotation ?? 0,
  };
}

export async function movePlaced(
  id: string,
  xIn: number,
  yIn: number,
): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE placed_pedals SET x_in = ?, y_in = ? WHERE id = ?', [
    xIn,
    yIn,
    id,
  ]);
}

export async function rotatePlaced(
  id: string,
  rotation: PlacedPedal['rotation'],
): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE placed_pedals SET rotation = ? WHERE id = ?', [
    rotation,
    id,
  ]);
}

export async function duplicatePlaced(id: string): Promise<PlacedPedal> {
  const db = await getDb();
  const rows = await db.select<PlacedRow>(
    'SELECT * FROM placed_pedals WHERE id = ?',
    [id],
  );
  const source = rows[0];
  if (!source) throw new Error(`Placed pedal ${id} not found`);
  return placePedal({
    rigId: source.rig_id,
    pedalId: source.pedal_id,
    xIn: source.x_in + 0.5,
    yIn: source.y_in + 0.5,
    rotation: rotationFromInt(source.rotation),
  });
}

export async function deletePlaced(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM placed_pedals WHERE id = ?', [id]);
}
