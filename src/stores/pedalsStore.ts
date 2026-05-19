import { create } from 'zustand';
import type { Pedal } from '../data/schema';
import {
  deletePedal as repoDelete,
  listPedals,
  pedalUsage as repoUsage,
} from '../data/pedalsRepo';
import { seedSamplePedals } from '../data/seedPedals';
import { usePlacedPedalsStore } from './placedPedalsStore';
import { useSignalChainStore } from './signalChainStore';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface PedalsState {
  pedals: Pedal[];
  status: Status;
  error: string | null;

  loadPedals: () => Promise<void>;
  seedSamples: () => Promise<number>;
  /** Returns the rig ids that currently have a placed instance of this pedal. */
  usage: (pedalId: string) => Promise<string[]>;
  /** Cascades through placements + connections, then drops the pedal. */
  deletePedal: (pedalId: string) => Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const usePedalsStore = create<PedalsState>((set, get) => ({
  pedals: [],
  status: 'idle',
  error: null,

  loadPedals: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const pedals = await listPedals();
      set({ pedals, status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: errorMessage(err) });
    }
  },

  seedSamples: async () => {
    const { added } = await seedSamplePedals();
    if (added > 0) {
      const pedals = await listPedals();
      set({ pedals });
    }
    return added;
  },

  usage: async (pedalId) => {
    const u = await repoUsage(pedalId);
    return u.rigIds;
  },

  deletePedal: async (pedalId) => {
    const { affectedRigIds } = await repoDelete(pedalId);
    // Drop the pedal from the library.
    set({ pedals: get().pedals.filter((p) => p.id !== pedalId) });
    // Refresh every rig that lost a placement, plus its signal chain since
    // we deleted connections too.
    const placedStore = usePlacedPedalsStore.getState();
    const chainStore = useSignalChainStore.getState();
    await Promise.all(
      affectedRigIds.flatMap((rigId) => [
        placedStore.loadForRig(rigId),
        chainStore.loadForRig(rigId),
      ]),
    );
  },
}));
