import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import { listPedals } from '../src/data/pedalsRepo';
import { colorFromImagePath, seedSamplePedals } from '../src/data/seedPedals';

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
});

describe('seedSamplePedals', () => {
  it('adds 6 sample pedals on first call', async () => {
    const { added } = await seedSamplePedals();
    expect(added).toBe(6);
    const all = await listPedals();
    expect(all).toHaveLength(6);
    expect(
      all.find((p) => p.name === 'Timeline')?.ports.length,
    ).toBeGreaterThan(2);
  });

  it('is idempotent', async () => {
    await seedSamplePedals();
    const second = await seedSamplePedals();
    expect(second.added).toBe(0);
    expect((await listPedals()).length).toBe(6);
  });

  it('records color via imagePath prefix', async () => {
    await seedSamplePedals();
    const ds1 = (await listPedals()).find((p) => p.name === 'DS-1');
    expect(colorFromImagePath(ds1?.imagePath ?? null)).toBe('#C62828');
    expect(colorFromImagePath(null)).toBeNull();
    expect(colorFromImagePath('/some/path.png')).toBeNull();
  });
});
