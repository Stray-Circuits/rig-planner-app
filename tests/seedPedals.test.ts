import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import { listPedals, updatePedal } from '../src/data/pedalsRepo';
import {
  __resetSeedPedalsForTests,
  seedDefaultPedals,
  SEED_PEDALS,
} from '../src/data/seedPedals';

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
  __resetSeedPedalsForTests();
});

describe('seedDefaultPedals', () => {
  it('inserts every seed pedal on an empty library', async () => {
    await seedDefaultPedals();
    const pedals = await listPedals();
    const byName = new Map(pedals.map((p) => [`${p.brand}|${p.name}`, p]));
    for (const spec of SEED_PEDALS) {
      const p = byName.get(`${spec.brand}|${spec.name}`);
      expect(p, `seed ${spec.name} missing`).toBeDefined();
      expect(p?.widthIn).toBe(spec.widthIn);
      expect(p?.depthIn).toBe(spec.depthIn);
      expect(p?.imagePath).toMatch(/^data:image\//);
      expect(p?.ports.map((x) => x.label).sort()).toEqual(
        spec.ports.map((x) => x.label).sort(),
      );
    }
  });

  it('is idempotent — running twice produces one copy of each', async () => {
    await seedDefaultPedals();
    await seedDefaultPedals();
    const pedals = await listPedals();
    const count = pedals.filter(
      (p) => p.brand === 'Stray Circuits' && p.name === 'Tabby Terror',
    ).length;
    expect(count).toBe(1);
  });

  it('coalesces concurrent calls — no duplicates under StrictMode-style double-invoke', async () => {
    await Promise.all([seedDefaultPedals(), seedDefaultPedals()]);
    const pedals = await listPedals();
    for (const spec of SEED_PEDALS) {
      const count = pedals.filter(
        (p) => p.brand === spec.brand && p.name === spec.name,
      ).length;
      expect(count, `${spec.name} duplicated`).toBe(1);
    }
  });

  it('re-seeds a pedal that was renamed (treats name as the match key)', async () => {
    await seedDefaultPedals();
    const before = await listPedals();
    const tabby = before.find((p) => p.name === 'Tabby Terror');
    expect(tabby).toBeDefined();
    if (!tabby) return;
    await updatePedal(tabby.id, {
      brand: tabby.brand,
      name: 'My Tabby',
      widthIn: tabby.widthIn,
      depthIn: tabby.depthIn,
      imagePath: tabby.imagePath,
      imageSourceUrl: tabby.imageSourceUrl,
      jackSides: tabby.jackSides,
      powerSide: tabby.powerSide,
      ports: tabby.ports,
    });

    await seedDefaultPedals();
    const after = await listPedals();
    expect(after.some((p) => p.name === 'My Tabby')).toBe(true);
    expect(after.some((p) => p.name === 'Tabby Terror')).toBe(true);
  });
});
