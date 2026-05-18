import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import { usePlacedPedalsStore } from '../src/stores/placedPedalsStore';

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
  usePlacedPedalsStore.setState({ byRig: {}, loadingRig: null });
});

describe('placedPedalsStore', () => {
  it('addPedalToRig appends to the rig list and persists', async () => {
    const placed = await usePlacedPedalsStore
      .getState()
      .addPedalToRig('rig-1', 'pedal-x', 1, 2);

    expect(usePlacedPedalsStore.getState().byRig['rig-1']).toEqual([placed]);

    // Reload from the underlying store to confirm persistence.
    await usePlacedPedalsStore.getState().loadForRig('rig-1');
    expect(usePlacedPedalsStore.getState().byRig['rig-1']).toHaveLength(1);
  });

  it('move mutates the row optimistically', async () => {
    const placed = await usePlacedPedalsStore
      .getState()
      .addPedalToRig('rig-1', 'pedal-x', 0, 0);
    await usePlacedPedalsStore.getState().move(placed.id, 4, 5);
    const after = usePlacedPedalsStore.getState().byRig['rig-1']?.[0];
    expect(after?.xIn).toBe(4);
    expect(after?.yIn).toBe(5);
  });

  it('dragMove updates only the in-memory state without persisting', async () => {
    const placed = await usePlacedPedalsStore
      .getState()
      .addPedalToRig('rig-1', 'pedal-x', 0, 0);
    usePlacedPedalsStore.getState().dragMove(placed.id, 9, 9);
    expect(usePlacedPedalsStore.getState().byRig['rig-1']?.[0]?.xIn).toBe(9);

    // Reload from the DB — confirm the drag-only move was NOT persisted.
    usePlacedPedalsStore.setState({ byRig: {}, loadingRig: null });
    await usePlacedPedalsStore.getState().loadForRig('rig-1');
    expect(usePlacedPedalsStore.getState().byRig['rig-1']?.[0]?.xIn).toBe(0);
  });

  it('commitMove persists whatever the current in-memory position is', async () => {
    const placed = await usePlacedPedalsStore
      .getState()
      .addPedalToRig('rig-1', 'pedal-x', 0, 0);
    usePlacedPedalsStore.getState().dragMove(placed.id, 7, 8);
    await usePlacedPedalsStore.getState().commitMove(placed.id);

    usePlacedPedalsStore.setState({ byRig: {}, loadingRig: null });
    await usePlacedPedalsStore.getState().loadForRig('rig-1');
    const reloaded = usePlacedPedalsStore.getState().byRig['rig-1']?.[0];
    expect(reloaded?.xIn).toBe(7);
    expect(reloaded?.yIn).toBe(8);
  });

  it('rotate updates the rotation', async () => {
    const placed = await usePlacedPedalsStore
      .getState()
      .addPedalToRig('rig-1', 'pedal-x', 0, 0);
    await usePlacedPedalsStore.getState().rotate(placed.id, 90);
    expect(usePlacedPedalsStore.getState().byRig['rig-1']?.[0]?.rotation).toBe(
      90,
    );
  });

  it('remove drops the row', async () => {
    const placed = await usePlacedPedalsStore
      .getState()
      .addPedalToRig('rig-1', 'pedal-x', 0, 0);
    await usePlacedPedalsStore.getState().remove(placed.id);
    expect(usePlacedPedalsStore.getState().byRig['rig-1']).toEqual([]);
  });
});
