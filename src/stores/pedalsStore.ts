import { create } from 'zustand';
import type { Pedal } from '../data/schema';
import {
  deletePedal as repoDelete,
  listPedals,
  pedalUsage as repoUsage,
} from '../data/pedalsRepo';
import { usePlacedPedalsStore } from './placedPedalsStore';
import { useSignalChainStore } from './signalChainStore';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface PedalsState {
  pedals: Pedal[];
  status: Status;
  error: string | null;
  /**
   * False while pedal images (data URLs or real photo paths) are still being
   * decoded by the browser. Flips true once every image attached to a pedal
   * in the library has either loaded or errored. UI surfaces a single
   * loading overlay while this is false on first paint so the user knows
   * something is happening instead of seeing half-painted boards.
   */
  imagesReady: boolean;

  loadPedals: () => Promise<void>;
  /** Returns the rig ids that currently have a placed instance of this pedal. */
  usage: (pedalId: string) => Promise<string[]>;
  /** Cascades through placements + connections, then drops the pedal. */
  deletePedal: (pedalId: string) => Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function imageSrcForPedal(p: Pedal): string | null {
  const path = p.imagePath;
  if (!path) return null;
  if (path.startsWith('color:')) return null;
  return path;
}

async function preloadPedalImages(pedals: readonly Pedal[]): Promise<void> {
  if (typeof Image === 'undefined') return;
  const srcs = pedals.map(imageSrcForPedal).filter((s): s is string => !!s);
  if (srcs.length === 0) return;
  await Promise.all(
    srcs.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  );
}

export const usePedalsStore = create<PedalsState>((set, get) => ({
  pedals: [],
  status: 'idle',
  error: null,
  imagesReady: false,

  loadPedals: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null, imagesReady: false });
    try {
      const pedals = await listPedals();
      set({ pedals, status: 'ready' });
      await preloadPedalImages(pedals);
      set({ imagesReady: true });
    } catch (err) {
      set({ status: 'error', error: errorMessage(err), imagesReady: true });
    }
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
