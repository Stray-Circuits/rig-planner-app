import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import type { Pedal } from '../src/data/schema';
import { usePlacedPedalsStore } from '../src/stores/placedPedalsStore';

function fakePedal(id: string, widthIn: number, depthIn: number): Pedal {
  return {
    id,
    brand: 'X',
    name: id,
    widthIn,
    depthIn,
    imagePath: null,
    imageSourceUrl: null,
    jackSides: {
      top: true,
      bottom: false,
      left: false,
      right: false,
      midi_top: false,
      midi_bottom: false,
      midi_left: false,
      midi_right: false,
    },
    powerSide: null,
    ports: [],
    createdAt: '',
    updatedAt: '',
  };
}

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

  describe('clampToRigBounds', () => {
    it('pulls pedals that hang off the new edge back into bounds and persists', async () => {
      const a = await usePlacedPedalsStore
        .getState()
        .addPedalToRig('rig-1', 'p-2x3', 20, 20);
      const b = await usePlacedPedalsStore
        .getState()
        .addPedalToRig('rig-1', 'p-2x3', 1, 1);

      const pedalsById = new Map([['p-2x3', fakePedal('p-2x3', 2, 3)]]);
      await usePlacedPedalsStore
        .getState()
        .clampToRigBounds({ id: 'rig-1', widthIn: 10, depthIn: 6 }, pedalsById);

      const after = usePlacedPedalsStore.getState().byRig['rig-1'] ?? [];
      const movedA = after.find((p) => p.id === a.id);
      const stillB = after.find((p) => p.id === b.id);
      expect(movedA?.xIn).toBe(8); // 10 - 2
      expect(movedA?.yIn).toBe(3); // 6 - 3
      // b already fit, untouched
      expect(stillB?.xIn).toBe(1);
      expect(stillB?.yIn).toBe(1);

      // Persisted: reload and confirm
      usePlacedPedalsStore.setState({ byRig: {}, loadingRig: null });
      await usePlacedPedalsStore.getState().loadForRig('rig-1');
      const reloaded = usePlacedPedalsStore.getState().byRig['rig-1'] ?? [];
      expect(reloaded.find((p) => p.id === a.id)?.xIn).toBe(8);
    });

    it('no-ops when every pedal already fits', async () => {
      const placed = await usePlacedPedalsStore
        .getState()
        .addPedalToRig('rig-1', 'p-1x1', 1, 1);
      const pedalsById = new Map([['p-1x1', fakePedal('p-1x1', 1, 1)]]);

      await usePlacedPedalsStore
        .getState()
        .clampToRigBounds(
          { id: 'rig-1', widthIn: 10, depthIn: 10 },
          pedalsById,
        );

      const after = usePlacedPedalsStore.getState().byRig['rig-1']?.[0];
      expect(after?.xIn).toBe(placed.xIn);
      expect(after?.yIn).toBe(placed.yIn);
    });

    it('honors rotated footprint when clamping', async () => {
      // A 1×4 pedal rotated 90° has footprint 4×1.
      const placed = await usePlacedPedalsStore
        .getState()
        .addPedalToRig('rig-1', 'p-1x4', 8, 0);
      await usePlacedPedalsStore.getState().rotate(placed.id, 90);

      const pedalsById = new Map([['p-1x4', fakePedal('p-1x4', 1, 4)]]);
      await usePlacedPedalsStore
        .getState()
        .clampToRigBounds({ id: 'rig-1', widthIn: 5, depthIn: 5 }, pedalsById);

      const after = usePlacedPedalsStore.getState().byRig['rig-1']?.[0];
      // After rotation footprint is 4×1, board is 5×5 → max x = 1.
      expect(after?.xIn).toBe(1);
    });
  });
});
