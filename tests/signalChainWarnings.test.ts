import { describe, expect, it } from 'vitest';
import { computeUnconnectedRequiredPorts } from '../src/lib/signalChainWarnings';
import type { Connection, Pedal, PlacedPedal } from '../src/data/schema';

const blankJacks = {
  top: true,
  bottom: false,
  left: false,
  right: false,
  midi_top: false,
  midi_bottom: false,
  midi_left: false,
  midi_right: false,
};

function mkPedal(): Pedal {
  return {
    id: 'pedal',
    brand: 'Boss',
    name: 'DS-1',
    widthIn: 3,
    depthIn: 5,
    imagePath: null,
    jackSides: blankJacks,
    powerSide: 'top',
    ports: [
      {
        id: 'in',
        pedalId: 'pedal',
        label: 'In',
        role: 'input',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 1,
        optional: false,
      },
      {
        id: 'out',
        pedalId: 'pedal',
        label: 'Out',
        role: 'output',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 0,
        optional: false,
      },
      {
        id: 'optional',
        pedalId: 'pedal',
        label: 'FX Send',
        role: 'fx_send',
        signalType: 'instrument',
        connector: 'ts',
        side: 'right',
        sideOrder: 0,
        optional: true,
      },
    ],
    createdAt: '',
    updatedAt: '',
  };
}

const placed: PlacedPedal[] = [
  {
    id: 'placed-1',
    rigId: 'rig-1',
    pedalId: 'pedal',
    xIn: 0,
    yIn: 0,
    rotation: 0,
  },
];

describe('computeUnconnectedRequiredPorts', () => {
  const map = new Map<string, Pedal>([['pedal', mkPedal()]]);

  it('flags both required ports when there are no connections', () => {
    const result = computeUnconnectedRequiredPorts(placed, map, []);
    expect(result).toEqual(new Set(['placed-1:in', 'placed-1:out']));
  });

  it('ignores optional ports even when unconnected', () => {
    const result = computeUnconnectedRequiredPorts(placed, map, []);
    expect(result.has('placed-1:optional')).toBe(false);
  });

  it('treats either direction of a connection as wiring the port', () => {
    const connections: Connection[] = [
      {
        id: 'c1',
        rigId: 'rig-1',
        fromNodeKind: 'pedal',
        fromNodeId: 'placed-1',
        fromPortId: 'out',
        toNodeKind: 'external',
        toNodeId: 'amp',
        toPortId: null,
      },
      {
        id: 'c2',
        rigId: 'rig-1',
        fromNodeKind: 'external',
        fromNodeId: 'guitar',
        fromPortId: null,
        toNodeKind: 'pedal',
        toNodeId: 'placed-1',
        toPortId: 'in',
      },
    ];
    const result = computeUnconnectedRequiredPorts(placed, map, connections);
    expect(result.size).toBe(0);
  });
});
