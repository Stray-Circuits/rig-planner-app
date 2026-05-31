import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests, __setDbForTests } from '../src/data/db';
import { useRigsStore } from '../src/stores/rigsStore';
import { useUiStore } from '../src/stores/uiStore';
import { createFakeDb, type FakeDb } from './fakeDb';

let db: FakeDb;

const baseRow = (id: string, name = 'A') => ({
  id,
  name,
  width_in: 24,
  depth_in: 8,
  style: 'rail',
  jack_size: 'large',
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-02 00:00:00',
});

beforeEach(() => {
  __resetDbForTests();
  db = createFakeDb();
  __setDbForTests(db);
  useRigsStore.setState({ rigs: [], status: 'idle', error: null });
  useUiStore.setState({ lastRigId: null });
});

describe('rigsStore', () => {
  it('loadRigs populates from the repo and sets status', async () => {
    db.mockSelect(/FROM rigs ORDER BY/, () => [baseRow('a'), baseRow('b')]);
    await useRigsStore.getState().loadRigs();
    expect(useRigsStore.getState().status).toBe('ready');
    expect(useRigsStore.getState().rigs).toHaveLength(2);
  });

  it('createRig prepends the new rig and updates lastRigId', async () => {
    db.mockSelect(/SELECT \* FROM rigs WHERE id/, (params) => [
      baseRow(params[0] as string, 'New'),
    ]);
    const created = await useRigsStore.getState().createRig({
      name: 'New',
      widthIn: 24,
      depthIn: 8,
      style: 'rail',
    });
    expect(useRigsStore.getState().rigs[0]?.id).toBe(created.id);
    expect(useUiStore.getState().lastRigId).toBe(created.id);
  });

  it('renameRig updates the in-memory row', async () => {
    useRigsStore.setState({
      rigs: [
        {
          id: 'r',
          name: 'Old',
          widthIn: 24,
          depthIn: 8,
          style: 'rail',
          presetId: null,
          jackSize: 'large',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    await useRigsStore.getState().renameRig('r', 'New name');
    expect(useRigsStore.getState().rigs[0]?.name).toBe('New name');
  });

  it('deleteRig removes the row and clears lastRigId when it matched', async () => {
    useRigsStore.setState({
      rigs: [
        {
          id: 'r',
          name: 'X',
          widthIn: 24,
          depthIn: 8,
          style: 'rail',
          presetId: null,
          jackSize: 'large',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    useUiStore.getState().setLastRigId('r');
    await useRigsStore.getState().deleteRig('r');
    expect(useRigsStore.getState().rigs).toHaveLength(0);
    expect(useUiStore.getState().lastRigId).toBeNull();
  });
});
