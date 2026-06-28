import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import {
  createPedal,
  getPedal,
  listPedals,
  updatePedal,
} from '../src/data/pedalsRepo';
import type { JackSides } from '../src/data/schema';

const blankJacks: JackSides = {
  top: false,
  bottom: false,
  left: false,
  right: false,
  midi_top: false,
  midi_bottom: false,
  midi_left: false,
  midi_right: false,
};

beforeEach(() => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
});

describe('pedalsRepo', () => {
  it('creates a pedal with ports and reads it back', async () => {
    const created = await createPedal({
      brand: 'Boss',
      name: 'DS-1',
      widthIn: 2.85,
      depthIn: 4.75,
      jackSides: { ...blankJacks, top: true },
      powerSide: 'bottom',
      ports: [
        {
          label: 'In',
          role: 'input',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 1,
          optional: false,
        },
        {
          label: 'Out',
          role: 'output',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 0,
          optional: false,
        },
      ],
    });
    expect(created.name).toBe('DS-1');
    expect(created.ports).toHaveLength(2);
    expect(created.ports[0]?.sideOrder).toBe(0); // sorted by sideOrder

    const refetched = await getPedal(created.id);
    expect(refetched?.ports[0]?.label).toBe('Out');
  });

  it('lists pedals sorted by brand then name', async () => {
    await createPedal({
      brand: 'MXR',
      name: 'Phase 90',
      widthIn: 2.25,
      depthIn: 4.4,
      jackSides: { ...blankJacks, top: true },
      ports: [],
    });
    await createPedal({
      brand: 'Boss',
      name: 'DS-1',
      widthIn: 2.85,
      depthIn: 4.75,
      jackSides: { ...blankJacks, top: true },
      ports: [],
    });
    const all = await listPedals();
    expect(all.map((p) => `${p.brand} ${p.name}`)).toEqual([
      'Boss DS-1',
      'MXR Phase 90',
    ]);
  });

  it('rejects unknown enum values when reading', async () => {
    await createPedal({
      brand: 'X',
      name: 'Y',
      widthIn: 1,
      depthIn: 1,
      jackSides: blankJacks,
      ports: [],
    });
    // Manually corrupt by inserting a bad port. We bypass the typed insert
    // by writing directly through the adapter — using the fact that the
    // browser memoryAdapter accepts any string for `side`.
    const { getDb } = await import('../src/data/db');
    const db = await getDb();
    await db.execute(
      'INSERT INTO ports (id, pedal_id, label, role, signal_type, connector, side, side_order, optional) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        'bad',
        (await listPedals())[0]!.id,
        'X',
        'input',
        'instrument',
        'ts',
        'diagonal',
        0,
        0,
      ],
    );
    await expect(listPedals()).rejects.toThrow(/Unknown side/);
  });

  // Issue #124: a pedal can carry more than one FX loop (two fx_send +
  // two fx_return ports). The pairs share identical labels, so reconciling
  // edited ports by (role, label) collapses each duplicate to one row and
  // deletes the rest. Editing the pedal must preserve every loop.
  it('preserves multiple identically-labeled FX loops across an edit (#124)', async () => {
    const created = await createPedal({
      brand: 'Strymon',
      name: 'Looper',
      widthIn: 4,
      depthIn: 5,
      jackSides: { ...blankJacks, top: true },
      ports: [
        {
          label: 'In',
          role: 'input',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 0,
          optional: false,
        },
        {
          label: 'Out',
          role: 'output',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 1,
          optional: false,
        },
        {
          label: 'FX Send',
          role: 'fx_send',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 2,
          optional: true,
        },
        {
          label: 'FX Return',
          role: 'fx_return',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 3,
          optional: true,
        },
        {
          label: 'FX Send',
          role: 'fx_send',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 4,
          optional: true,
        },
        {
          label: 'FX Return',
          role: 'fx_return',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 5,
          optional: true,
        },
      ],
    });
    expect(created.ports.filter((p) => p.role === 'fx_send')).toHaveLength(2);
    expect(created.ports.filter((p) => p.role === 'fx_return')).toHaveLength(2);

    // Simulate an edit that passes the same ports back (e.g. a rename),
    // matching the shape the wizard sends today (id + pedalId stripped).
    const { pedal } = await updatePedal(created.id, {
      brand: created.brand,
      name: 'Looper MkII',
      widthIn: created.widthIn,
      depthIn: created.depthIn,
      jackSides: { ...blankJacks, top: true },
      ports: created.ports.map(
        ({ id: _id, pedalId: _pedalId, ...rest }) => rest,
      ),
    });

    expect(pedal.ports.filter((p) => p.role === 'fx_send')).toHaveLength(2);
    expect(pedal.ports.filter((p) => p.role === 'fx_return')).toHaveLength(2);
  });

  // When the wizard passes port ids back (its real behavior), reconciliation
  // keeps each port's identity — including a renamed one — so connections
  // referencing those ports survive the edit.
  it('preserves port identity (and renames) when ids are passed through (#124)', async () => {
    const created = await createPedal({
      brand: 'EHX',
      name: 'POG',
      widthIn: 4,
      depthIn: 5,
      jackSides: { ...blankJacks, top: true },
      ports: [
        {
          label: 'In',
          role: 'input',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 0,
          optional: false,
        },
        {
          label: 'Out',
          role: 'output',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 1,
          optional: false,
        },
      ],
    });
    const originalIds = created.ports.map((p) => p.id).sort();

    // Rename "Out" but keep its id, mirroring the wizard payload.
    const { pedal } = await updatePedal(created.id, {
      brand: created.brand,
      name: created.name,
      widthIn: created.widthIn,
      depthIn: created.depthIn,
      jackSides: { ...blankJacks, top: true },
      ports: created.ports.map(({ pedalId: _pedalId, ...rest }) => ({
        ...rest,
        label: rest.role === 'output' ? 'Output' : rest.label,
      })),
    });

    expect(pedal.ports.map((p) => p.id).sort()).toEqual(originalIds);
    const out = pedal.ports.find((p) => p.role === 'output');
    expect(out?.label).toBe('Output');
    expect(out?.id).toBe(created.ports.find((p) => p.role === 'output')?.id);
  });
});
