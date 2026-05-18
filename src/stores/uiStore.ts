import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
