import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests, __setDbForTests } from '../src/data/db';
import {
  createRig,
  deleteRig,
  duplicateRig,
  getRig,
  listRigs,
  renameRig,
  touchRig,
  updateRigDimensions,
  updateRigStyle,
} from '../src/data/rigsRepo';
import { createFakeDb, type FakeDb } from './fakeDb';

let db: FakeDb;

beforeEach(() => {
  __resetDbForTests();
  db = createFakeDb();
  __setDbForTests(db);
});

const fakeRow = (id: string, name = 'Main board') => ({
  id,
  name,
  width_in: 32,
  depth_in: 16,
  style: 'rail',
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-02 00:00:00',
});

describe('rigsRepo.listRigs', () => {
  it('returns rows mapped to camelCase Rigs', async () => {
    db.mockSelect(/SELECT \* FROM rigs ORDER BY/, () => [
      fakeRow('a', 'Main'),
      fakeRow('b', 'Fly'),
    ]);
    const rigs = await listRigs();
    expect(rigs).toHaveLength(2);
    expect(rigs[0]).toMatchObject({ id: 'a', name: 'Main', widthIn: 32 });
  });

  it('rejects rows with unknown styles', async () => {
    db.mockSelect(/SELECT \* FROM rigs/, () => [
      { ...fakeRow('a'), style: 'bogus' },
    ]);
    await expect(listRigs()).rejects.toThrow(/Unknown board style/);
  });
});

describe('rigsRepo.createRig', () => {
  it('inserts and returns the created rig', async () => {
    db.mockSelect(/SELECT \* FROM rigs WHERE id = \?/, (params) => [
      fakeRow(params[0] as string, 'My rig'),
    ]);

    const created = await createRig({
      name: 'My rig',
      widthIn: 24,
      depthIn: 8,
      style: 'rail',
    });

    const insert = db.executes.find((c) => c.sql.includes('INSERT INTO rigs'));
    expect(insert?.params).toEqual([
      created.id,
      'My rig',
      24,
      8,
      'rail',
      null,
      'large',
    ]);
    expect(created.name).toBe('My rig');
  });

  it('writes the presetId when provided', async () => {
    db.mockSelect(/SELECT \* FROM rigs WHERE id = \?/, (params) => [
      {
        ...fakeRow(params[0] as string, 'My rig'),
        preset_id: 'pedaltrain-nano',
      },
    ]);

    const created = await createRig({
      name: 'My rig',
      widthIn: 14,
      depthIn: 5.5,
      style: 'rail',
      presetId: 'pedaltrain-nano',
    });

    const insert = db.executes.find((c) => c.sql.includes('INSERT INTO rigs'));
    expect(insert?.params).toEqual([
      created.id,
      'My rig',
      14,
      5.5,
      'rail',
      'pedaltrain-nano',
      'large',
    ]);
    expect(created.presetId).toBe('pedaltrain-nano');
  });

  it('rejects empty names', async () => {
    await expect(
      createRig({ name: '   ', widthIn: 24, depthIn: 8, style: 'rail' }),
    ).rejects.toThrow(/empty/);
  });

  it('rejects non-positive dimensions', async () => {
    await expect(
      createRig({ name: 'x', widthIn: 0, depthIn: 8, style: 'rail' }),
    ).rejects.toThrow(/positive/);
  });
});

describe('rigsRepo.renameRig', () => {
  it('issues an UPDATE with the trimmed name', async () => {
    await renameRig('abc', '  Renamed  ');
    const call = db.executes.find((c) =>
      c.sql.includes('UPDATE rigs SET name'),
    );
    expect(call?.params).toEqual(['Renamed', 'abc']);
  });

  it('rejects empty names', async () => {
    await expect(renameRig('abc', '   ')).rejects.toThrow(/empty/);
  });
});

describe('rigsRepo.deleteRig', () => {
  it('issues a DELETE', async () => {
    await deleteRig('abc');
    expect(db.executes.some((c) => c.sql.includes('DELETE FROM rigs'))).toBe(
      true,
    );
  });
});

describe('rigsRepo.touchRig', () => {
  it('updates the updated_at timestamp', async () => {
    await touchRig('abc');
    const call = db.executes.find((c) =>
      c.sql.includes('updated_at = datetime'),
    );
    expect(call?.params).toEqual(['abc']);
  });
});

describe('rigsRepo.updateRigStyle', () => {
  it('issues a style UPDATE', async () => {
    await updateRigStyle('abc', 'wood');
    const call = db.executes.find((c) => c.sql.includes('SET style'));
    expect(call?.params).toEqual(['wood', 'abc']);
  });
});

describe('rigsRepo.updateRigDimensions', () => {
  it('updates width + depth in one query', async () => {
    await updateRigDimensions('abc', 30, 14);
    const call = db.executes.find((c) => c.sql.includes('SET width_in'));
    expect(call?.params).toEqual([30, 14, 'abc']);
  });

  it('rejects non-positive dimensions', async () => {
    await expect(updateRigDimensions('abc', 0, 10)).rejects.toThrow(/positive/);
    await expect(updateRigDimensions('abc', 10, -1)).rejects.toThrow(
      /positive/,
    );
  });
});

describe('rigsRepo.getRig', () => {
  it('returns null when not found', async () => {
    db.mockSelect(/SELECT \* FROM rigs WHERE id/, () => []);
    expect(await getRig('missing')).toBeNull();
  });

  it('returns the rig when found', async () => {
    db.mockSelect(/SELECT \* FROM rigs WHERE id/, () => [fakeRow('a')]);
    const r = await getRig('a');
    expect(r?.id).toBe('a');
  });
});

describe('rigsRepo.duplicateRig', () => {
  it('copies the rig and remaps related-table IDs', async () => {
    const source = fakeRow('rig-1', 'Original');
    const placed = [
      {
        id: 'placed-1',
        pedal_id: 'pedal-x',
        x_in: 1,
        y_in: 2,
        rotation: 0,
      },
    ];
    const endpoints = [{ id: 'ep-1', kind: 'guitar', label: 'Guitar' }];
    const connections = [
      {
        from_node_kind: 'external',
        from_node_id: 'ep-1',
        from_port_id: null,
        to_node_kind: 'pedal',
        to_node_id: 'placed-1',
        to_port_id: 'port-1',
      },
    ];

    // The repo issues two `SELECT * FROM rigs WHERE id = ?` calls: first the
    // source lookup, then a re-fetch of the newly-created row. Synthesize
    // both from the params so we don't need to know the new id in advance.
    db.mockSelect(/SELECT \* FROM rigs WHERE id = \?/, (params) => {
      const id = params[0] as string;
      if (id === 'rig-1') return [source];
      return [{ ...source, id, name: 'Original (copy)' }];
    });
    db.mockSelect(/FROM placed_pedals/, () => placed);
    db.mockSelect(/FROM external_endpoints/, () => endpoints);
    db.mockSelect(/FROM connections/, () => connections);

    const dup = await duplicateRig('rig-1');
    expect(dup.name).toBe('Original (copy)');
    expect(dup.id).not.toBe('rig-1');

    const placedInsert = db.executes.find((c) =>
      c.sql.includes('INSERT INTO placed_pedals'),
    );
    expect(placedInsert?.params[2]).toBe('pedal-x');

    const connInsert = db.executes.find((c) =>
      c.sql.includes('INSERT INTO connections'),
    );
    // from_node_id (endpoint) must have been remapped to the new endpoint id
    expect(connInsert?.params[3]).not.toBe('ep-1');
    // to_node_id (placed pedal) must have been remapped to the new placed id
    expect(connInsert?.params[6]).not.toBe('placed-1');
  });

  it('throws when the source rig does not exist', async () => {
    db.mockSelect(/SELECT \* FROM rigs WHERE id/, () => []);
    await expect(duplicateRig('missing')).rejects.toThrow(/not found/);
  });
});
