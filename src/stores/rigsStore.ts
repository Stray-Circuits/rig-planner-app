import { create } from 'zustand';
import type { Rig } from '../data/schema';
import {
  createRig as repoCreate,
  deleteRig as repoDelete,
  duplicateRig as repoDuplicate,
  listRigs,
  renameRig as repoRename,
  touchRig as repoTouch,
} from '../data/rigsRepo';
import { useUiStore } from './uiStore';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RigsState {
  rigs: Rig[];
  status: LoadStatus;
  error: string | null;

  loadRigs: () => Promise<void>;
  createRig: (input: {
    name: string;
    widthIn: number;
    depthIn: number;
    style: Rig['style'];
  }) => Promise<Rig>;
  renameRig: (id: string, name: string) => Promise<void>;
  duplicateRig: (id: string) => Promise<Rig>;
  deleteRig: (id: string) => Promise<void>;
  openRig: (id: string) => Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useRigsStore = create<RigsState>((set, get) => ({
  rigs: [],
  status: 'idle',
  error: null,

  loadRigs: async () => {
    set({ status: 'loading', error: null });
    try {
      const rigs = await listRigs();
      set({ rigs, status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: errorMessage(err) });
    }
  },

  createRig: async (input) => {
    const rig = await repoCreate(input);
    set({ rigs: [rig, ...get().rigs] });
    useUiStore.getState().setLastRigId(rig.id);
    return rig;
  },

  renameRig: async (id, name) => {
    await repoRename(id, name);
    set({
      rigs: get().rigs.map((r) =>
        r.id === id ? { ...r, name: name.trim() } : r,
      ),
    });
  },

  duplicateRig: async (id) => {
    const dup = await repoDuplicate(id);
    set({ rigs: [dup, ...get().rigs] });
    return dup;
  },

  deleteRig: async (id) => {
    await repoDelete(id);
    const remaining = get().rigs.filter((r) => r.id !== id);
    set({ rigs: remaining });
    const ui = useUiStore.getState();
    if (ui.lastRigId === id) ui.setLastRigId(null);
  },

  openRig: async (id) => {
    await repoTouch(id);
    useUiStore.getState().setLastRigId(id);
    set({
      rigs: get()
        .rigs.map((r) =>
          r.id === id ? { ...r, updatedAt: new Date().toISOString() } : r,
        )
        .sort((a, b) => (b.updatedAt < a.updatedAt ? -1 : 1)),
    });
  },
}));
