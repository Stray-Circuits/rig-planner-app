/**
 * Database access layer.
 *
 * Uses tauri-plugin-sql when running inside a Tauri shell. Falls back to a
 * no-op in-memory adapter when running in a plain browser context (vitest,
 * `vite preview` outside Tauri) so the UI shell still boots for development.
 */
import { MIGRATIONS } from './migrations';

export interface DbAdapter {
  execute(sql: string, params?: unknown[]): Promise<void>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

let adapterPromise: Promise<DbAdapter> | null = null;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function createTauriAdapter(): Promise<DbAdapter> {
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  const db = await Database.load('sqlite:rigplanner.db');
  return {
    execute: async (sql, params) => {
      await db.execute(sql, params as unknown[] | undefined);
    },
    select: async <T>(sql: string, params?: unknown[]) =>
      db.select<T[]>(sql, params as unknown[] | undefined),
    close: async () => {
      await db.close();
    },
  };
}

function createMemoryAdapter(): DbAdapter {
  console.info(
    '[db] Tauri not detected — using in-memory stub. Data will not persist.',
  );
  return {
    execute: async () => {},
    select: async () => [],
    close: async () => {},
  };
}

async function runMigrations(adapter: DbAdapter): Promise<void> {
  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const applied = await adapter.select<{ version: number }>(
    'SELECT version FROM _migrations ORDER BY version ASC',
  );
  const appliedVersions = new Set(applied.map((r) => r.version));
  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    for (const stmt of migration.statements) {
      await adapter.execute(stmt);
    }
    await adapter.execute('INSERT INTO _migrations (version) VALUES (?)', [
      migration.version,
    ]);
  }
}

export function initDb(): Promise<DbAdapter> {
  if (!adapterPromise) {
    adapterPromise = (async () => {
      const adapter = isTauri()
        ? await createTauriAdapter()
        : createMemoryAdapter();
      if (isTauri()) {
        await runMigrations(adapter);
      }
      return adapter;
    })();
  }
  return adapterPromise;
}

export async function getDb(): Promise<DbAdapter> {
  return initDb();
}

/** Test-only: reset the cached adapter so a fresh init can happen. */
export function __resetDbForTests(): void {
  adapterPromise = null;
}
