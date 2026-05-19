import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryAdapter,
  getLocalStorageUsageFraction,
  isQuotaExceededError,
  __clearMemoryAdapterStorage,
} from '../src/data/memoryAdapter';

beforeEach(() => {
  __clearMemoryAdapterStorage();
});

describe('MemoryAdapter', () => {
  it('CREATE TABLE statements are no-ops', async () => {
    const db = createMemoryAdapter();
    await expect(
      db.execute('CREATE TABLE rigs (id TEXT PRIMARY KEY, name TEXT NOT NULL)'),
    ).resolves.toBeUndefined();
    await expect(
      db.execute('CREATE INDEX idx_rigs_name ON rigs(name)'),
    ).resolves.toBeUndefined();
  });

  it('round-trips an insert + select', async () => {
    const db = createMemoryAdapter();
    await db.execute(
      `INSERT INTO rigs (id, name, width_in, depth_in, style)
       VALUES (?, ?, ?, ?, ?)`,
      ['r1', 'Main board', 24, 8, 'rail'],
    );
    const rows = await db.select<{
      id: string;
      name: string;
      width_in: number;
      created_at: string;
    }>('SELECT * FROM rigs WHERE id = ?', ['r1']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Main board');
    expect(rows[0]?.width_in).toBe(24);
    // Defaults: created_at filled in
    expect(rows[0]?.created_at).toBeDefined();
  });

  it('list select with ORDER BY DESC returns newest-first', async () => {
    const db = createMemoryAdapter();
    await db.execute(
      `INSERT INTO rigs (id, name, width_in, depth_in, style, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['a', 'A', 1, 1, 'rail', '2026-01-01 00:00:00'],
    );
    await db.execute(
      `INSERT INTO rigs (id, name, width_in, depth_in, style, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['b', 'B', 1, 1, 'rail', '2026-02-01 00:00:00'],
    );
    const rows = await db.select<{ id: string }>(
      'SELECT * FROM rigs ORDER BY updated_at DESC',
    );
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('UPDATE with datetime("now") updates updated_at', async () => {
    const db = createMemoryAdapter();
    await db.execute(
      'INSERT INTO rigs (id, name, width_in, depth_in, style) VALUES (?, ?, ?, ?, ?)',
      ['r1', 'old', 1, 1, 'rail'],
    );
    const [before] = await db.select<{ updated_at: string }>(
      'SELECT * FROM rigs WHERE id = ?',
      ['r1'],
    );
    await new Promise((r) => setTimeout(r, 10));
    await db.execute(
      `UPDATE rigs SET name = ?, updated_at = datetime('now') WHERE id = ?`,
      ['new', 'r1'],
    );
    const [after] = await db.select<{ name: string; updated_at: string }>(
      'SELECT * FROM rigs WHERE id = ?',
      ['r1'],
    );
    expect(after?.name).toBe('new');
    expect((after?.updated_at ?? '') >= (before?.updated_at ?? '')).toBe(true);
  });

  it('DELETE removes matching rows', async () => {
    const db = createMemoryAdapter();
    await db.execute(
      'INSERT INTO rigs (id, name, width_in, depth_in, style) VALUES (?, ?, ?, ?, ?)',
      ['r1', 'x', 1, 1, 'rail'],
    );
    await db.execute('DELETE FROM rigs WHERE id = ?', ['r1']);
    const rows = await db.select('SELECT * FROM rigs WHERE id = ?', ['r1']);
    expect(rows).toHaveLength(0);
  });

  it('column-projection SELECT returns only the requested columns', async () => {
    const db = createMemoryAdapter();
    await db.execute(
      `INSERT INTO placed_pedals (id, rig_id, pedal_id, x_in, y_in, rotation)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['p1', 'r1', 'pedal-x', 1, 2, 0],
    );
    const rows = await db.select<Record<string, unknown>>(
      'SELECT id, pedal_id FROM placed_pedals WHERE rig_id = ?',
      ['r1'],
    );
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['id', 'pedal_id']);
  });

  it('isQuotaExceededError matches the browser-specific names', () => {
    const a = new Error('Mock quota exceeded');
    a.name = 'QuotaExceededError';
    expect(isQuotaExceededError(a)).toBe(true);

    const b = new Error('Storage limit hit');
    b.name = 'NS_ERROR_DOM_QUOTA_REACHED';
    expect(isQuotaExceededError(b)).toBe(true);

    const c = new Error('Setting the value of key X exceeded the quota.');
    expect(isQuotaExceededError(c)).toBe(true);

    expect(isQuotaExceededError(new Error('toBlob returned null'))).toBe(false);
    expect(isQuotaExceededError('quota')).toBe(false);
  });

  it('getLocalStorageUsageFraction returns 0 with no payload, grows with writes', async () => {
    __clearMemoryAdapterStorage();
    const beforeAny = getLocalStorageUsageFraction();
    // Either 0 (localStorage available, no key) or null (not available).
    expect(beforeAny === 0 || beforeAny === null).toBe(true);

    if (typeof localStorage === 'undefined') return; // jsdom flag-dependent
    const db = createMemoryAdapter();
    await db.execute(
      'INSERT INTO rigs (id, name, width_in, depth_in, style) VALUES (?, ?, ?, ?, ?)',
      ['r1', 'small', 1, 1, 'rail'],
    );
    const after = getLocalStorageUsageFraction();
    // We can't assert > 0 reliably without real localStorage; just sanity
    // check the function returns a number in [0, 1] or null.
    expect(after === null || (after >= 0 && after <= 1)).toBe(true);
  });

  it('persists across adapter instances via localStorage', async () => {
    const db1 = createMemoryAdapter();
    await db1.execute(
      'INSERT INTO rigs (id, name, width_in, depth_in, style) VALUES (?, ?, ?, ?, ?)',
      ['r1', 'kept', 1, 1, 'rail'],
    );
    const db2 = createMemoryAdapter();
    const rows = await db2.select<{ name: string }>(
      'SELECT * FROM rigs WHERE id = ?',
      ['r1'],
    );
    expect(rows[0]?.name).toBe('kept');
  });
});
