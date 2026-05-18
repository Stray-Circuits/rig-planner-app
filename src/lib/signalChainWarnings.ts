import type { Connection, Pedal, PlacedPedal } from '../data/schema';

export interface PortKey {
  placedId: string;
  portId: string;
}

export function portKeyId(k: PortKey): string {
  return `${k.placedId}:${k.portId}`;
}

/**
 * Returns the set of placed-pedal port keys that:
 *  1. belong to a placed pedal whose definition we know about,
 *  2. are NOT marked optional in the pedal definition,
 *  3. have no Connection touching them (in either direction).
 *
 * Used to surface "unconnected required port" warnings while the signal-chain
 * overlay is on.
 */
export function computeUnconnectedRequiredPorts(
  placed: PlacedPedal[],
  pedalsById: Map<string, Pedal>,
  connections: Connection[],
): Set<string> {
  const connected = new Set<string>();
  for (const c of connections) {
    if (c.fromNodeKind === 'pedal' && c.fromPortId) {
      connected.add(
        portKeyId({ placedId: c.fromNodeId, portId: c.fromPortId }),
      );
    }
    if (c.toNodeKind === 'pedal' && c.toPortId) {
      connected.add(portKeyId({ placedId: c.toNodeId, portId: c.toPortId }));
    }
  }
  const unconnected = new Set<string>();
  for (const p of placed) {
    const def = pedalsById.get(p.pedalId);
    if (!def) continue;
    for (const port of def.ports) {
      if (port.optional) continue;
      const key = portKeyId({ placedId: p.id, portId: port.id });
      if (!connected.has(key)) unconnected.add(key);
    }
  }
  return unconnected;
}
