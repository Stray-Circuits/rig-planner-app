import { describe, expect, it } from 'vitest';
import type {
  Connection,
  ExternalEndpoint,
  Pedal,
  PlacedPedal,
  Rig,
} from '../src/data/schema';
import {
  RIG_EXPORT_KIND,
  RIG_EXPORT_VERSION,
  buildRigExport,
  defaultExportFilename,
  parseRigExport,
} from '../src/lib/rigPortability';

function makeRig(overrides: Partial<Rig> = {}): Rig {
  return {
    id: 'rig-1',
    name: 'Main Board',
    widthIn: 32,
    depthIn: 16,
    style: 'rail',
    presetId: null,
    jackSize: 'large',
    floorStyle: 'concrete_grey',
    customFloor: { color: '#8a8a8a', grain: 0.4 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makePedal(id: string, overrides: Partial<Pedal> = {}): Pedal {
  return {
    id,
    brand: 'Acme',
    name: `Stomp ${id}`,
    widthIn: 4,
    depthIn: 2.5,
    imagePath: `color:#aabbcc`,
    imageSourceUrl: null,
    jackSides: {
      top: true,
      bottom: false,
      left: false,
      right: false,
      midi_top: false,
      midi_bottom: false,
      midi_left: false,
      midi_right: false,
    },
    powerSide: 'top',
    ports: [
      {
        id: `${id}-in`,
        pedalId: id,
        label: 'In',
        role: 'input',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 0,
        optional: false,
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildRigExport', () => {
  it('keeps only pedals referenced by the rig', () => {
    const rig = makeRig();
    const placed: PlacedPedal[] = [
      {
        id: 'pl-1',
        rigId: rig.id,
        pedalId: 'p-1',
        xIn: 1,
        yIn: 1,
        rotation: 0,
      },
    ];
    const exp = buildRigExport({
      rig,
      pedals: [makePedal('p-1'), makePedal('p-2'), makePedal('p-3')],
      placedPedals: placed,
      endpoints: [],
      connections: [],
    });
    expect(exp.pedals.map((p) => p.id)).toEqual(['p-1']);
  });

  it('writes the export kind + version sentinels', () => {
    const exp = buildRigExport({
      rig: makeRig(),
      pedals: [],
      placedPedals: [],
      endpoints: [],
      connections: [],
    });
    expect(exp.kind).toBe(RIG_EXPORT_KIND);
    expect(exp.version).toBe(RIG_EXPORT_VERSION);
    expect(typeof exp.exportedAt).toBe('string');
  });
});

describe('defaultExportFilename', () => {
  it('sanitises spaces and forbidden characters', () => {
    const name = defaultExportFilename({ name: 'My / Big "Rig"?  ' });
    expect(name).toMatch(/^My-Big-Rig-\d{4}-\d{2}-\d{2}\.rig\.json$/);
  });

  it('falls back to "rig" when the name is empty after sanitising', () => {
    const name = defaultExportFilename({ name: '   /// ' });
    expect(name).toMatch(/^rig-\d{4}-\d{2}-\d{2}\.rig\.json$/);
  });
});

describe('parseRigExport', () => {
  const valid = buildRigExport({
    rig: makeRig(),
    pedals: [makePedal('p-1')],
    placedPedals: [
      {
        id: 'pl-1',
        rigId: 'rig-1',
        pedalId: 'p-1',
        xIn: 1,
        yIn: 1,
        rotation: 0,
      },
    ],
    endpoints: [],
    connections: [],
  });
  const validJson = JSON.stringify(valid);

  it('round-trips a valid export', () => {
    const parsed = parseRigExport(validJson);
    expect(parsed.rig.id).toBe('rig-1');
    expect(parsed.pedals).toHaveLength(1);
    expect(parsed.placedPedals).toHaveLength(1);
  });

  it('rejects non-JSON', () => {
    expect(() => parseRigExport('not json')).toThrow(/valid JSON/);
  });

  it('rejects the wrong kind sentinel', () => {
    const bad = JSON.stringify({ ...valid, kind: 'something-else' });
    expect(() => parseRigExport(bad)).toThrow(/Unsupported file kind/);
  });

  it('rejects an unsupported version', () => {
    const bad = JSON.stringify({ ...valid, version: 99 });
    expect(() => parseRigExport(bad)).toThrow(/Unsupported export version/);
  });

  it('rejects missing rig', () => {
    const { rig: _rig, ...rest } = valid;
    void _rig;
    const bad = JSON.stringify(rest);
    expect(() => parseRigExport(bad)).toThrow(/Missing rig/);
  });

  it('rejects rig with missing fields', () => {
    const bad = JSON.stringify({ ...valid, rig: { id: 'r' } });
    expect(() => parseRigExport(bad)).toThrow(/Missing or invalid/);
  });

  it('rejects when arrays are missing', () => {
    const { connections: _c, ...rest } = valid;
    void _c;
    const bad = JSON.stringify(rest);
    expect(() => parseRigExport(bad)).toThrow(/connections/);
  });
});

describe('export → import round-trip (pure)', () => {
  it('preserves placed pedals, endpoints, and connections verbatim', () => {
    const rig = makeRig();
    const pedals = [makePedal('p-1'), makePedal('p-2')];
    const placed: PlacedPedal[] = [
      {
        id: 'pl-1',
        rigId: rig.id,
        pedalId: 'p-1',
        xIn: 2,
        yIn: 3,
        rotation: 90,
      },
      {
        id: 'pl-2',
        rigId: rig.id,
        pedalId: 'p-2',
        xIn: 5,
        yIn: 1,
        rotation: 0,
      },
    ];
    const endpoints: ExternalEndpoint[] = [
      { id: 'ep-1', rigId: rig.id, kind: 'guitar', label: 'Guitar' },
      { id: 'ep-2', rigId: rig.id, kind: 'amp_in', label: 'Amp' },
    ];
    const connections: Connection[] = [
      {
        id: 'c-1',
        rigId: rig.id,
        fromNodeKind: 'external',
        fromNodeId: 'ep-1',
        fromPortId: null,
        toNodeKind: 'pedal',
        toNodeId: 'pl-1',
        toPortId: 'p-1-in',
      },
    ];
    const exp = buildRigExport({
      rig,
      pedals,
      placedPedals: placed,
      endpoints,
      connections,
    });
    const reparsed = parseRigExport(JSON.stringify(exp));
    expect(reparsed.placedPedals).toEqual(placed);
    expect(reparsed.externalEndpoints).toEqual(endpoints);
    expect(reparsed.connections).toEqual(connections);
    expect(reparsed.pedals).toEqual(pedals);
  });
});
