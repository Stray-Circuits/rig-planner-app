import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, __resetDbForTests } from '../src/data/db';

describe('db adapter (memory fallback outside Tauri)', () => {
  beforeEach(() => {
    __resetDbForTests();
  });

  it('returns an adapter with the expected shape', async () => {
    const db = await initDb();
    expect(db).toMatchObject({
      execute: expect.any(Function),
      select: expect.any(Function),
      close: expect.any(Function),
    });
  });

  it('select returns an empty array from the memory stub', async () => {
    const db = await initDb();
    const rows = await db.select<{ x: number }>('SELECT 1');
    expect(rows).toEqual([]);
  });
});
