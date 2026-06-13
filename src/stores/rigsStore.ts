import { create } from 'zustand';
import type { CustomFloor, FloorStyle, JackSize, Rig } from '../data/schema';
import {
  createRig as repoCreate,
  deleteRig as repoDelete,
  duplicateRig as repoDuplicate,
  listRigs,
  renameRig as repoRename,
  touchRig as repoTouch,
  updateRigBoard as repoUpdateBoard,
  updateRigCustomFloor as repoUpdateCustomFloor,
  updateRigDimensions as repoUpdateDimensions,
  updateRigFloorStyle as repoUpdateFloorStyle,
  updateRigJackSize as repoUpdateJackSize,
  updateRigStyle as repoUpdateStyle,
} from '../data/rigsRepo';
import { ensureLegacyFloorBackfill } from '../data/legacyFloorBackfill';
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
    presetId?: string | null;
  }) => Promise<Rig>;
  renameRig: (id: string, name: string) => Promise<void>;
  updateStyle: (id: string, style: Rig['style']) => Promise<void>;
  updateDimensions: (
    id: string,
    widthIn: number,
    depthIn: number,
  ) => Promise<void>;
  updateBoard: (
    id: string,
    widthIn: number,
    depthIn: number,
    style: Rig['style'],
    presetId: string | null,
  ) => Promise<void>;
  updateJackSize: (id: string, jackSize: JackSize) => Promise<void>;
  updateFloorStyle: (id: string, floorStyle: FloorStyle) => Promise<void>;
  updateCustomFloor: (id: string, customFloor: CustomFloor) => Promise<void>;
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
      await ensureLegacyFloorBackfill();
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

  updateStyle: async (id, style) => {
    await repoUpdateStyle(id, style);
    set({
      rigs: get().rigs.map((r) => (r.id === id ? { ...r, style } : r)),
    });
  },

  updateDimensions: async (id, widthIn, depthIn) => {
    await repoUpdateDimensions(id, widthIn, depthIn);
    set({
      rigs: get().rigs.map((r) =>
        r.id === id ? { ...r, widthIn, depthIn } : r,
      ),
    });
  },

  updateBoard: async (id, widthIn, depthIn, style, presetId) => {
    await repoUpdateBoard(id, widthIn, depthIn, style, presetId);
    set({
      rigs: get().rigs.map((r) =>
        r.id === id ? { ...r, widthIn, depthIn, style, presetId } : r,
      ),
    });
  },

  updateJackSize: async (id, jackSize) => {
    await repoUpdateJackSize(id, jackSize);
    set({
      rigs: get().rigs.map((r) => (r.id === id ? { ...r, jackSize } : r)),
    });
  },

  updateFloorStyle: async (id, floorStyle) => {
    await repoUpdateFloorStyle(id, floorStyle);
    set({
      rigs: get().rigs.map((r) => (r.id === id ? { ...r, floorStyle } : r)),
    });
  },

  updateCustomFloor: async (id, customFloor) => {
    await repoUpdateCustomFloor(id, customFloor);
    set({
      rigs: get().rigs.map((r) => (r.id === id ? { ...r, customFloor } : r)),
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
