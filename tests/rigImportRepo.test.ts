import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDbForTests, initDb } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';
import { createRig, getRig, listRigs } from '../src/data/rigsRepo';
import { createPedal, listPedals } from '../src/data/pedalsRepo';
import { placePedal, listPlacedPedals } from '../src/data/placedPedalsRepo';
import { createConnection, listConnections } from '../src/data/connectionsRepo';
import {
  createEndpoint,
  listEndpoints,
} from '../src/data/externalEndpointsRepo';
import { findExistingRigForImport, importRig } from '../src/data/rigImportRepo';
import { buildRigExport } from '../src/lib/rigPortability';

beforeEach(async () => {
  __resetDbForTests();
  __clearMemoryAdapterStorage();
  await initDb();
});

async function seedSampleRig(): Promise<{
  rigId: string;
  pedalId: string;
  placedId: string;
  guitarId: string;
  connectionId: string;
}> {
  const rig = await createRig({
    name: 'Source Rig',
    widthIn: 30,
    depthIn: 14,
    style: 'rail',
  });
  const pedal = await createPedal({
    brand: 'Acme',
    name: 'Overdrive',
    widthIn: 4,
    depthIn: 2.5,
    imagePath: 'color:#ff8800',
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
  const placed = await placePedal({
    rigId: rig.id,
    pedalId: pedal.id,
    xIn: 4,
    yIn: 5,
    rotation: 90,
  });
  const guitar = await createEndpoint({
    rigId: rig.id,
    kind: 'guitar',
    label: 'Guitar',
  });
  const inputPort = pedal.ports.find((p) => p.role === 'input');
  if (!inputPort) throw new Error('seed pedal missing input port');
  const conn = await createConnection({
    rigId: rig.id,
    fromNodeKind: 'external',
    fromNodeId: guitar.id,
    fromPortId: null,
    toNodeKind: 'pedal',
    toNodeId: placed.id,
    toPortId: inputPort.id,
  });
  return {
    rigId: rig.id,
    pedalId: pedal.id,
    placedId: placed.id,
    guitarId: guitar.id,
    connectionId: conn.id,
  };
}

describe('rigImportRepo: round-trip into a fresh DB', () => {
  it('export → wipe DB → import reproduces the same rig', async () => {
    const seeded = await seedSampleRig();

    const [rig] = await Promise.all([getRig(seeded.rigId)]);
    expect(rig).not.toBeNull();
    const pedals = await listPedals();
    const placed = await listPlacedPedals(seeded.rigId);
    const endpoints = await listEndpoints(seeded.rigId);
    const connections = await listConnections(seeded.rigId);
    const exp = buildRigExport({
      rig: rig!,
      pedals,
      placedPedals: placed,
      endpoints,
      connections,
    });

    // Wipe DB and replay the import.
    __resetDbForTests();
    __clearMemoryAdapterStorage();
    await initDb();
    expect(await listRigs()).toHaveLength(0);
    expect(await listPedals()).toHaveLength(0);

    const result = await importRig(exp);
    expect(result.replaced).toBe(false);
    expect(result.rigId).toBe(seeded.rigId);

    const restored = await getRig(seeded.rigId);
    expect(restored).toMatchObject({
      id: seeded.rigId,
      name: 'Source Rig',
      widthIn: 30,
      depthIn: 14,
      style: 'rail',
    });
    const restoredPedals = await listPedals();
    expect(restoredPedals).toHaveLength(1);
    expect(restoredPedals[0]?.id).toBe(seeded.pedalId);
    expect(restoredPedals[0]?.ports).toHaveLength(2);
    // Port IDs from the export are preserved so connections still resolve.
    const restoredPlaced = await listPlacedPedals(seeded.rigId);
    expect(restoredPlaced).toHaveLength(1);
    expect(restoredPlaced[0]).toMatchObject({
      id: seeded.placedId,
      rotation: 90,
      xIn: 4,
      yIn: 5,
    });
    const restoredConns = await listConnections(seeded.rigId);
    expect(restoredConns).toHaveLength(1);
    expect(restoredConns[0]?.id).toBe(seeded.connectionId);
    // The connection's toPortId must still point at a real port on the
    // restored pedal.
    const portIds = new Set(restoredPedals[0]?.ports.map((p) => p.id));
    expect(portIds.has(restoredConns[0]!.toPortId!)).toBe(true);
  });

  it('detects rig-ID collision before importing', async () => {
    const seeded = await seedSampleRig();
    const rig = await getRig(seeded.rigId);
    const pedals = await listPedals();
    const placed = await listPlacedPedals(seeded.rigId);
    const endpoints = await listEndpoints(seeded.rigId);
    const connections = await listConnections(seeded.rigId);
    const exp = buildRigExport({
      rig: rig!,
      pedals,
      placedPedals: placed,
      endpoints,
      connections,
    });
    const existing = await findExistingRigForImport(exp);
    expect(existing).toEqual({ id: seeded.rigId, name: 'Source Rig' });
  });

  it('overwrite replaces placements + connections of an existing rig', async () => {
    const seeded = await seedSampleRig();
    const rig = await getRig(seeded.rigId);
    const pedals = await listPedals();
    const placed = await listPlacedPedals(seeded.rigId);
    const endpoints = await listEndpoints(seeded.rigId);
    const connections = await listConnections(seeded.rigId);

    // Build the export, then mutate the source DB so we can prove the
    // import overwrites those mutations.
    const exp = buildRigExport({
      rig: rig!,
      pedals,
      placedPedals: placed,
      endpoints,
      connections,
    });
    // Add an extra connection that's NOT in the export — it should be
    // wiped by the overwrite.
    const extra = await createConnection({
      rigId: seeded.rigId,
      fromNodeKind: 'external',
      fromNodeId: seeded.guitarId,
      fromPortId: null,
      toNodeKind: 'pedal',
      toNodeId: seeded.placedId,
      toPortId: null,
    });
    expect(await listConnections(seeded.rigId)).toHaveLength(2);

    const result = await importRig(exp);
    expect(result.replaced).toBe(true);

    const restoredConns = await listConnections(seeded.rigId);
    expect(restoredConns).toHaveLength(1);
    expect(restoredConns.find((c) => c.id === extra.id)).toBeUndefined();
  });
});
