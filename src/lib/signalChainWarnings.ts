import type {
  Connection,
  Pedal,
  PlacedPedal,
  PortRole,
  SignalType,
} from '../data/schema';

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

/**
 * Ordinal for grouping a port by signal-chain role:
 *   0 = input (incl. fx_return, which is an input from the loop's perspective)
 *   1 = output (incl. fx_send)
 *   2 = expression / cv / remote — sidechain/control
 *   3 = midi
 * Lower = painted earlier (underneath) in cable z-order; higher = on top.
 * Audio sits at the base, control above it, MIDI on top so annotation-style
 * cables don't get buried.
 */
export function roleGroup(role: PortRole): number {
  switch (role) {
    case 'input':
    case 'input_l':
    case 'input_r':
    case 'stereo_input':
    case 'fx_return':
      return 0;
    case 'output':
    case 'output_l':
    case 'output_r':
    case 'stereo_output':
    case 'fx_send':
      return 1;
    case 'expression':
    case 'cv':
    case 'remote':
      return 2;
    case 'midi_in':
    case 'midi_out':
      return 3;
  }
}

/** Coarse signal family — used to flag incompatible cable pairings. */
export type SignalFamily = 'audio' | 'midi' | 'control';

export function signalFamily(signalType: SignalType): SignalFamily {
  switch (signalType) {
    case 'instrument':
    case 'line':
    case 'line_balanced':
    case 'stereo':
    case 'amp_level':
      return 'audio';
    case 'midi':
      return 'midi';
    case 'cv':
    case 'expression':
    case 'remote':
      return 'control';
  }
}

/**
 * Whether two ports can be cabled together. Audio↔MIDI and audio↔control
 * are flagged as incompatible; control↔MIDI is also flagged (different
 * physical connectors, no real signal path). Same-family is always OK —
 * the user can still wire e.g. an instrument output into a line input
 * with a quality compromise but no protocol mismatch.
 */
export function connectionCompatibility(
  a: SignalType,
  b: SignalType,
): { ok: true } | { ok: false; reason: string } {
  const fa = signalFamily(a);
  const fb = signalFamily(b);
  if (fa === fb) return { ok: true };
  const families = [fa, fb].sort().join('-');
  return {
    ok: false,
    reason: `Can't connect ${families.replace('-', ' to ')}.`,
  };
}

/**
 * Stable sort order for connections by their "from" port's role group.
 * Connections to/from external endpoints (which have no port role) sort
 * last within their family so they paint on top of pedal-to-pedal cables.
 */
export function sortConnectionsForRender(
  connections: readonly Connection[],
  placed: readonly PlacedPedal[],
  pedalsById: Map<string, Pedal>,
): Connection[] {
  const placedById = new Map(placed.map((p) => [p.id, p] as const));
  const groupOf = (c: Connection): number => {
    const portId = c.fromPortId ?? c.toPortId;
    const placedId =
      c.fromPortId !== null && c.fromPortId !== undefined
        ? c.fromNodeId
        : c.toNodeId;
    if (!portId) return 2; // external endpoint cable with no port — treat as control-ish
    const placedPedal = placedById.get(placedId);
    if (!placedPedal) return 2;
    const pedal = pedalsById.get(placedPedal.pedalId);
    if (!pedal) return 2;
    const port = pedal.ports.find((p) => p.id === portId);
    if (!port) return 2;
    return roleGroup(port.role);
  };
  return connections
    .map((c, i) => ({ c, i, g: groupOf(c) }))
    .sort((a, b) => (a.g === b.g ? a.i - b.i : a.g - b.g))
    .map((x) => x.c);
}
