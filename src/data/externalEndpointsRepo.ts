import { getDb } from './db';
import type { ExternalEndpoint, ExternalEndpointKind } from './schema';
import { newId } from '../lib/ids';

interface EndpointRow {
  id: string;
  rig_id: string;
  kind: string;
  label: string;
}

const VALID_KINDS: readonly ExternalEndpointKind[] = [
  'guitar',
  'amp_in',
  'amp_fx_send',
  'amp_fx_return',
  'custom',
];

function assertKind(s: string): ExternalEndpointKind {
  if ((VALID_KINDS as readonly string[]).includes(s)) {
    return s as ExternalEndpointKind;
  }
  throw new Error(`Unknown endpoint kind "${s}"`);
}

function fromRow(row: EndpointRow): ExternalEndpoint {
  return {
    id: row.id,
    rigId: row.rig_id,
    kind: assertKind(row.kind),
    label: row.label,
  };
}

export async function listEndpoints(
  rigId: string,
): Promise<ExternalEndpoint[]> {
  const db = await getDb();
  const rows = await db.select<EndpointRow>(
    'SELECT * FROM external_endpoints WHERE rig_id = ?',
    [rigId],
  );
  return rows.map(fromRow);
}

export interface CreateEndpointInput {
  rigId: string;
  kind: ExternalEndpointKind;
  label: string;
}

export async function createEndpoint(
  input: CreateEndpointInput,
): Promise<ExternalEndpoint> {
  const id = newId();
  const db = await getDb();
  await db.execute(
    `INSERT INTO external_endpoints (id, rig_id, kind, label)
     VALUES (?, ?, ?, ?)`,
    [id, input.rigId, input.kind, input.label],
  );
  return { id, rigId: input.rigId, kind: input.kind, label: input.label };
}

export async function deleteEndpoint(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM external_endpoints WHERE id = ?', [id]);
}

/**
 * Returns the default endpoints every rig should have: Guitar (source) and
 * Amp (sink). Idempotent — only creates them if absent.
 */
export async function ensureDefaultEndpoints(
  rigId: string,
): Promise<ExternalEndpoint[]> {
  const existing = await listEndpoints(rigId);
  const have = new Set(existing.map((e) => e.kind));
  const toCreate: { kind: ExternalEndpointKind; label: string }[] = [];
  if (!have.has('guitar')) toCreate.push({ kind: 'guitar', label: 'Guitar' });
  if (!have.has('amp_in')) toCreate.push({ kind: 'amp_in', label: 'Amp' });
  for (const e of toCreate) {
    await createEndpoint({ rigId, ...e });
  }
  if (toCreate.length === 0) return existing;
  return listEndpoints(rigId);
}
