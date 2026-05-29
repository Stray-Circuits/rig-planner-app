import { describe, expect, it } from 'vitest';
import {
  computeUnconnectedRequiredPorts,
  connectionCompatibility,
  maxCablesForConnector,
  roleGroup,
  signalFamily,
  sortConnectionsForRender,
} from '../src/lib/signalChainWarnings';
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
    imageSourceUrl: null,
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

  it('groups ports by role: input(0) < output(1) < expression(2) < midi(3)', () => {
    expect(roleGroup('input')).toBe(0);
    expect(roleGroup('fx_return')).toBe(0);
    expect(roleGroup('output')).toBe(1);
    expect(roleGroup('fx_send')).toBe(1);
    expect(roleGroup('expression')).toBe(2);
    expect(roleGroup('cv')).toBe(2);
    expect(roleGroup('midi_in')).toBe(3);
    expect(roleGroup('midi_out')).toBe(3);
  });

  it('maps signal types to families and blocks cross-family connections', () => {
    expect(signalFamily('instrument')).toBe('audio');
    expect(signalFamily('midi')).toBe('midi');
    expect(signalFamily('expression')).toBe('control');
    expect(connectionCompatibility('instrument', 'line').ok).toBe(true);
    expect(connectionCompatibility('midi', 'midi').ok).toBe(true);
    expect(connectionCompatibility('instrument', 'midi').ok).toBe(false);
    expect(connectionCompatibility('expression', 'line').ok).toBe(false);
  });

  it('sorts connections by from-port role group (audio first, midi last)', () => {
    const pedal: Pedal = { ...mkPedal() };
    // Add a midi-out port to the same pedal for the test.
    pedal.ports = [
      ...pedal.ports,
      {
        id: 'midi-out',
        pedalId: 'pedal',
        label: 'MIDI Out',
        role: 'midi_out',
        signalType: 'midi',
        connector: 'midi_din',
        side: 'right',
        sideOrder: 1,
        optional: false,
      },
    ];
    const pedalMap = new Map<string, Pedal>([['pedal', pedal]]);
    const cMidi: Connection = {
      id: 'c-midi',
      rigId: 'rig-1',
      fromNodeKind: 'pedal',
      fromNodeId: 'placed-1',
      fromPortId: 'midi-out',
      toNodeKind: 'pedal',
      toNodeId: 'placed-1',
      toPortId: 'midi-out',
    };
    const cOut: Connection = {
      id: 'c-out',
      rigId: 'rig-1',
      fromNodeKind: 'pedal',
      fromNodeId: 'placed-1',
      fromPortId: 'out',
      toNodeKind: 'external',
      toNodeId: 'amp',
      toPortId: null,
    };
    const cIn: Connection = {
      id: 'c-in',
      rigId: 'rig-1',
      fromNodeKind: 'pedal',
      fromNodeId: 'placed-1',
      fromPortId: 'in',
      toNodeKind: 'external',
      toNodeId: 'g',
      toPortId: null,
    };
    const sorted = sortConnectionsForRender(
      [cMidi, cOut, cIn],
      placed,
      pedalMap,
    );
    expect(sorted.map((c) => c.id)).toEqual(['c-in', 'c-out', 'c-midi']);
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

describe('maxCablesForConnector', () => {
  it('TRS holds two cables (splitter rule); all other connectors hold one', () => {
    expect(maxCablesForConnector('trs')).toBe(2);
    expect(maxCablesForConnector('ts')).toBe(1);
    expect(maxCablesForConnector('xlr')).toBe(1);
    expect(maxCablesForConnector('midi_din')).toBe(1);
    expect(maxCablesForConnector('midi_trs')).toBe(1);
  });
});
