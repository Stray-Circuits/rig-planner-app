import { create } from 'zustand';
import type { Connection, ExternalEndpoint } from '../data/schema';
import {
  createConnection,
  deleteConnection,
  listConnections,
  type CreateConnectionInput,
} from '../data/connectionsRepo';
import {
  createEndpoint,
  deleteEndpoint,
  ensureDefaultEndpoints,
  listEndpoints,
} from '../data/externalEndpointsRepo';

interface SignalChainState {
  /** Connections grouped by rigId. */
  connectionsByRig: Record<string, Connection[]>;
  endpointsByRig: Record<string, ExternalEndpoint[]>;
  loading: string | null;

  loadForRig: (rigId: string) => Promise<void>;
  addConnection: (input: CreateConnectionInput) => Promise<Connection>;
  removeConnection: (rigId: string, connectionId: string) => Promise<void>;
  addEndpoint: (
    rigId: string,
    kind: ExternalEndpoint['kind'],
    label: string,
  ) => Promise<ExternalEndpoint>;
  removeEndpoint: (rigId: string, endpointId: string) => Promise<void>;
}

function update<T>(
  map: Record<string, T[]>,
  rigId: string,
  fn: (list: T[]) => T[],
): Record<string, T[]> {
  return { ...map, [rigId]: fn(map[rigId] ?? []) };
}

export const useSignalChainStore = create<SignalChainState>((set, get) => ({
  connectionsByRig: {},
  endpointsByRig: {},
  loading: null,

  loadForRig: async (rigId) => {
    set({ loading: rigId });
    try {
      // Seed Guitar + Amp on first open so the user has somewhere to route to.
      await ensureDefaultEndpoints(rigId);
      const [connections, endpoints] = await Promise.all([
        listConnections(rigId),
        listEndpoints(rigId),
      ]);
      set((s) => ({
        connectionsByRig: { ...s.connectionsByRig, [rigId]: connections },
        endpointsByRig: { ...s.endpointsByRig, [rigId]: endpoints },
      }));
    } finally {
      if (get().loading === rigId) set({ loading: null });
    }
  },

  addConnection: async (input) => {
    const created = await createConnection(input);
    set((s) => ({
      connectionsByRig: update(s.connectionsByRig, input.rigId, (list) => [
        ...list,
        created,
      ]),
    }));
    return created;
  },

  removeConnection: async (rigId, connectionId) => {
    await deleteConnection(connectionId);
    set((s) => ({
      connectionsByRig: update(s.connectionsByRig, rigId, (list) =>
        list.filter((c) => c.id !== connectionId),
      ),
    }));
  },

  addEndpoint: async (rigId, kind, label) => {
    const created = await createEndpoint({ rigId, kind, label });
    set((s) => ({
      endpointsByRig: update(s.endpointsByRig, rigId, (list) => [
        ...list,
        created,
      ]),
    }));
    return created;
  },

  removeEndpoint: async (rigId, endpointId) => {
    await deleteEndpoint(endpointId);
    set((s) => ({
      endpointsByRig: update(s.endpointsByRig, rigId, (list) =>
        list.filter((e) => e.id !== endpointId),
      ),
    }));
  },
}));
