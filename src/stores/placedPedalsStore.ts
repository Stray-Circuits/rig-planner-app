import { create } from 'zustand';
import type { PlacedPedal } from '../data/schema';
import {
  deletePlaced,
  duplicatePlaced,
  listPlacedPedals,
  movePlaced,
  placePedal,
  rotatePlaced,
} from '../data/placedPedalsRepo';

interface PlacedState {
  /** rigId -> array of placed pedals for that rig */
  byRig: Record<string, PlacedPedal[]>;
  loadingRig: string | null;

  loadForRig: (rigId: string) => Promise<void>;
  addPedalToRig: (
    rigId: string,
    pedalId: string,
    xIn: number,
    yIn: number,
  ) => Promise<PlacedPedal>;
  /** In-memory move during a drag; does NOT touch the DB. */
  dragMove: (placedId: string, xIn: number, yIn: number) => void;
  /** Persist the current position of `placedId` to the DB. */
  commitMove: (placedId: string) => Promise<void>;
  /** One-shot move with persistence. Used outside of drag gestures. */
  move: (placedId: string, xIn: number, yIn: number) => Promise<void>;
  rotate: (
    placedId: string,
    rotation: PlacedPedal['rotation'],
  ) => Promise<void>;
  duplicate: (placedId: string) => Promise<PlacedPedal>;
  remove: (placedId: string) => Promise<void>;
}

function updateRigList(
  byRig: Record<string, PlacedPedal[]>,
  rigId: string,
  fn: (list: PlacedPedal[]) => PlacedPedal[],
): Record<string, PlacedPedal[]> {
  return { ...byRig, [rigId]: fn(byRig[rigId] ?? []) };
}

function findRigOf(
  byRig: Record<string, PlacedPedal[]>,
  placedId: string,
): { rigId: string; placed: PlacedPedal } | null {
  for (const [rigId, list] of Object.entries(byRig)) {
    const placed = list.find((p) => p.id === placedId);
    if (placed) return { rigId, placed };
  }
  return null;
}

export const usePlacedPedalsStore = create<PlacedState>((set, get) => ({
  byRig: {},
  loadingRig: null,

  loadForRig: async (rigId) => {
    set({ loadingRig: rigId });
    try {
      const placed = await listPlacedPedals(rigId);
      set((s) => ({ byRig: { ...s.byRig, [rigId]: placed } }));
    } finally {
      if (get().loadingRig === rigId) set({ loadingRig: null });
    }
  },

  addPedalToRig: async (rigId, pedalId, xIn, yIn) => {
    const placed = await placePedal({ rigId, pedalId, xIn, yIn });
    set((s) => ({
      byRig: updateRigList(s.byRig, rigId, (list) => [...list, placed]),
    }));
    return placed;
  },

  dragMove: (placedId, xIn, yIn) => {
    const found = findRigOf(get().byRig, placedId);
    if (!found) return;
    set((s) => ({
      byRig: updateRigList(s.byRig, found.rigId, (list) =>
        list.map((p) => (p.id === placedId ? { ...p, xIn, yIn } : p)),
      ),
    }));
  },

  commitMove: async (placedId) => {
    const found = findRigOf(get().byRig, placedId);
    if (!found) return;
    await movePlaced(placedId, found.placed.xIn, found.placed.yIn);
  },

  move: async (placedId, xIn, yIn) => {
    const found = findRigOf(get().byRig, placedId);
    if (!found) return;
    set((s) => ({
      byRig: updateRigList(s.byRig, found.rigId, (list) =>
        list.map((p) => (p.id === placedId ? { ...p, xIn, yIn } : p)),
      ),
    }));
    await movePlaced(placedId, xIn, yIn);
  },

  rotate: async (placedId, rotation) => {
    const found = findRigOf(get().byRig, placedId);
    if (!found) return;
    set((s) => ({
      byRig: updateRigList(s.byRig, found.rigId, (list) =>
        list.map((p) => (p.id === placedId ? { ...p, rotation } : p)),
      ),
    }));
    await rotatePlaced(placedId, rotation);
  },

  duplicate: async (placedId) => {
    const found = findRigOf(get().byRig, placedId);
    if (!found) throw new Error('Placed pedal not found in store');
    const dup = await duplicatePlaced(placedId);
    set((s) => ({
      byRig: updateRigList(s.byRig, found.rigId, (list) => [...list, dup]),
    }));
    return dup;
  },

  remove: async (placedId) => {
    const found = findRigOf(get().byRig, placedId);
    if (!found) return;
    set((s) => ({
      byRig: updateRigList(s.byRig, found.rigId, (list) =>
        list.filter((p) => p.id !== placedId),
      ),
    }));
    await deletePlaced(placedId);
  },
}));
