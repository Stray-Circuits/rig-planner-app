import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import {
  createEndpoint,
  deleteEndpoint,
  ensureDefaultEndpoints,
  listEndpoints,
} from '../src/data/externalEndpointsRepo';

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
});

describe('externalEndpointsRepo', () => {
  it('round-trips create / list / delete', async () => {
    const ep = await createEndpoint({
      rigId: 'rig-1',
      kind: 'guitar',
      label: 'Strat',
    });
    expect((await listEndpoints('rig-1'))[0]?.label).toBe('Strat');
    await deleteEndpoint(ep.id);
    expect(await listEndpoints('rig-1')).toEqual([]);
  });

  it('ensureDefaultEndpoints adds Guitar + Amp the first time, no-ops after', async () => {
    const first = await ensureDefaultEndpoints('rig-1');
    expect(first.map((e) => e.kind).sort()).toEqual(['amp_in', 'guitar']);
    const second = await ensureDefaultEndpoints('rig-1');
    expect(second).toHaveLength(2);
  });
});
