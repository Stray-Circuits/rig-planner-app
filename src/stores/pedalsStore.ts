import { create } from 'zustand';
import type { Pedal } from '../data/schema';
import { listPedals } from '../data/pedalsRepo';
import { seedSamplePedals } from '../data/seedPedals';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface PedalsState {
  pedals: Pedal[];
  status: Status;
  error: string | null;

  loadPedals: () => Promise<void>;
  seedSamples: () => Promise<number>;
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
}));
