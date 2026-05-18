import { create } from 'zustand';
import {
  persist,
  createJSONStorage,
  type StateStorage,
} from 'zustand/middleware';

interface UiState {
  /** ID of the most-recently-opened rig, used to reopen on launch. */
  lastRigId: string | null;
  /** Render scale in pixels per inch. */
  pxPerInch: number;
  /** Whether the signal-chain overlay is currently visible. */
  chainVisible: boolean;

  setLastRigId: (id: string | null) => void;
  setPxPerInch: (n: number) => void;
  setChainVisible: (b: boolean) => void;
}

const DEFAULT_PX_PER_INCH = 18;

const memoryStorage: StateStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
})();

function pickStorage(): StateStorage {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access can throw in sandboxed contexts; fall through.
  }
  return memoryStorage;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      lastRigId: null,
      pxPerInch: DEFAULT_PX_PER_INCH,
      chainVisible: false,

      setLastRigId: (id) => set({ lastRigId: id }),
      setPxPerInch: (n) => set({ pxPerInch: Math.max(4, Math.min(96, n)) }),
      setChainVisible: (b) => set({ chainVisible: b }),
    }),
    {
      name: 'rig-planner-ui',
      storage: createJSONStorage(() => pickStorage()),
      version: 1,
    },
  ),
);
