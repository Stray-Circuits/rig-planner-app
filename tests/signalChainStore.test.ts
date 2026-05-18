import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import { useSignalChainStore } from '../src/stores/signalChainStore';

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
  useSignalChainStore.setState({
    connectionsByRig: {},
    endpointsByRig: {},
    loading: null,
  });
});

describe('signalChainStore', () => {
  it('loadForRig seeds Guitar + Amp endpoints once', async () => {
    await useSignalChainStore.getState().loadForRig('rig-1');
    const eps = useSignalChainStore.getState().endpointsByRig['rig-1'] ?? [];
    expect(eps.map((e) => e.kind).sort()).toEqual(['amp_in', 'guitar']);

    // Re-loading doesn't duplicate.
    await useSignalChainStore.getState().loadForRig('rig-1');
    expect(useSignalChainStore.getState().endpointsByRig['rig-1']?.length).toBe(
      2,
    );
  });

  it('addConnection / removeConnection persists and updates the store', async () => {
    await useSignalChainStore.getState().loadForRig('rig-1');
    const conn = await useSignalChainStore.getState().addConnection({
      rigId: 'rig-1',
      fromNodeKind: 'pedal',
      fromNodeId: 'a',
      fromPortId: 'a-out',
      toNodeKind: 'pedal',
      toNodeId: 'b',
      toPortId: 'b-in',
    });
    expect(
      useSignalChainStore.getState().connectionsByRig['rig-1'],
    ).toHaveLength(1);

    await useSignalChainStore.getState().removeConnection('rig-1', conn.id);
    expect(useSignalChainStore.getState().connectionsByRig['rig-1']).toEqual(
      [],
    );
  });
});
