import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import {
  createConnection,
  deleteConnection,
  listConnections,
} from '../src/data/connectionsRepo';

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
});

describe('connectionsRepo', () => {
  it('creates, lists, and deletes connections scoped by rig', async () => {
    const created = await createConnection({
      rigId: 'rig-1',
      fromNodeKind: 'pedal',
      fromNodeId: 'placed-1',
      fromPortId: 'port-out',
      toNodeKind: 'pedal',
      toNodeId: 'placed-2',
      toPortId: 'port-in',
    });
    expect(created.id).toBeDefined();

    const list = await listConnections('rig-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.fromPortId).toBe('port-out');
    expect(list[0]?.toNodeKind).toBe('pedal');

    expect(await listConnections('rig-other')).toEqual([]);

    await deleteConnection(created.id);
    expect(await listConnections('rig-1')).toEqual([]);
  });

  it('rejects unknown node kinds when reading', async () => {
    // Manually corrupt by writing a bad kind through the adapter.
    const { getDb } = await import('../src/data/db');
    const db = await getDb();
    await db.execute(
      `INSERT INTO connections (id, rig_id, from_node_kind, from_node_id, from_port_id,
                                to_node_kind, to_node_id, to_port_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['bad', 'rig-1', 'pedal', 'a', 'b', 'spaceship', 'c', 'd'],
    );
    await expect(listConnections('rig-1')).rejects.toThrow(/Unknown node kind/);
  });
});
