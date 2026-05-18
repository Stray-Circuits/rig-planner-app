import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import {
  deletePlaced,
  duplicatePlaced,
  listPlacedPedals,
  movePlaced,
  placePedal,
  rotatePlaced,
} from '../src/data/placedPedalsRepo';

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
});

describe('placedPedalsRepo', () => {
  it('places, moves, rotates, duplicates, and deletes', async () => {
    const placed = await placePedal({
      rigId: 'rig-1',
      pedalId: 'pedal-1',
      xIn: 1,
      yIn: 2,
    });
    expect(placed.rotation).toBe(0);

    await movePlaced(placed.id, 5, 6);
    let list = await listPlacedPedals('rig-1');
    expect(list[0]?.xIn).toBe(5);
    expect(list[0]?.yIn).toBe(6);

    await rotatePlaced(placed.id, 90);
    list = await listPlacedPedals('rig-1');
    expect(list[0]?.rotation).toBe(90);

    const dup = await duplicatePlaced(placed.id);
    expect(dup.id).not.toBe(placed.id);
    expect(dup.xIn).toBeCloseTo(5.5);
    list = await listPlacedPedals('rig-1');
    expect(list).toHaveLength(2);

    await deletePlaced(placed.id);
    list = await listPlacedPedals('rig-1');
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(dup.id);
  });

  it('duplicate throws when source is missing', async () => {
    await expect(duplicatePlaced('missing')).rejects.toThrow(/not found/);
  });
});
