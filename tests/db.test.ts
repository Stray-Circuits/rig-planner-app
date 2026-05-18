import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, __resetDbForTests } from '../src/data/db';
import { __clearMemoryAdapterStorage } from '../src/data/memoryAdapter';

describe('initDb (memory adapter outside Tauri)', () => {
  beforeEach(() => {
    __resetDbForTests();
    __clearMemoryAdapterStorage();
  });

  it('returns an adapter with the expected shape', async () => {
    const db = await initDb();
    expect(db).toMatchObject({
      execute: expect.any(Function),
      select: expect.any(Function),
      close: expect.any(Function),
    });
  });

  it('inserted rows are queryable through the same adapter', async () => {
    const db = await initDb();
    await db.execute(
      'INSERT INTO rigs (id, name, width_in, depth_in, style) VALUES (?, ?, ?, ?, ?)',
      ['r1', 'A', 24, 8, 'rail'],
    );
    const rows = await db.select<{ name: string }>(
      'SELECT * FROM rigs WHERE id = ?',
      ['r1'],
    );
    expect(rows[0]?.name).toBe('A');
  });
});
