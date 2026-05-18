import { getDb } from './db';
import type { Connection, NodeKind } from './schema';
import { newId } from '../lib/ids';

interface ConnectionRow {
  id: string;
  rig_id: string;
  from_node_kind: string;
  from_node_id: string;
  from_port_id: string | null;
  to_node_kind: string;
  to_node_id: string;
  to_port_id: string | null;
}

function assertKind(s: string): NodeKind {
  if (s === 'pedal' || s === 'external') return s;
  throw new Error(`Unknown node kind "${s}"`);
}

function fromRow(row: ConnectionRow): Connection {
  return {
    id: row.id,
    rigId: row.rig_id,
    fromNodeKind: assertKind(row.from_node_kind),
    fromNodeId: row.from_node_id,
    fromPortId: row.from_port_id,
    toNodeKind: assertKind(row.to_node_kind),
    toNodeId: row.to_node_id,
    toPortId: row.to_port_id,
  };
}

export async function listConnections(rigId: string): Promise<Connection[]> {
  const db = await getDb();
  const rows = await db.select<ConnectionRow>(
    'SELECT * FROM connections WHERE rig_id = ?',
    [rigId],
  );
  return rows.map(fromRow);
}

export interface CreateConnectionInput {
  rigId: string;
  fromNodeKind: NodeKind;
  fromNodeId: string;
  fromPortId: string | null;
  toNodeKind: NodeKind;
  toNodeId: string;
  toPortId: string | null;
}

export async function createConnection(
  input: CreateConnectionInput,
): Promise<Connection> {
  const id = newId();
  const db = await getDb();
  await db.execute(
    `INSERT INTO connections (id, rig_id, from_node_kind, from_node_id, from_port_id,
                              to_node_kind, to_node_id, to_port_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.rigId,
      input.fromNodeKind,
      input.fromNodeId,
      input.fromPortId,
      input.toNodeKind,
      input.toNodeId,
      input.toPortId,
    ],
  );
  return {
    id,
    rigId: input.rigId,
    fromNodeKind: input.fromNodeKind,
    fromNodeId: input.fromNodeId,
    fromPortId: input.fromPortId,
    toNodeKind: input.toNodeKind,
    toNodeId: input.toNodeId,
    toPortId: input.toPortId,
  };
}

export async function deleteConnection(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM connections WHERE id = ?', [id]);
}
