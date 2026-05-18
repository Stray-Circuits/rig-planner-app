/**
 * Database access layer.
 *
 * Uses tauri-plugin-sql when running inside a Tauri shell. Falls back to a
 * no-op in-memory adapter when running in a plain browser context (vitest,
 * `vite preview` outside Tauri) so the UI shell still boots for development.
 */
import { createMemoryAdapter } from './memoryAdapter';

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
      await db.execute(sql, params);
    },
    select: <T>(sql: string, params?: unknown[]): Promise<T[]> =>
      db.select<T[]>(sql, params),
    close: async () => {
      await db.close();
    },
  };
}

function createBrowserAdapter(): DbAdapter {
  console.info(
    '[db] Tauri not detected — using in-memory adapter (localStorage-backed).',
  );
  return createMemoryAdapter();
}

export function initDb(): Promise<DbAdapter> {
  adapterPromise ??= (async () => {
    if (isTauri()) {
      const adapter = await createTauriAdapter();
      // Tauri-side plugin-sql runs its own migrations (see src-tauri/src/lib.rs);
      // nothing to do here.
      return adapter;
    }
    // Memory adapter is schema-less — it creates tables lazily as rows
    // arrive, so no migrations to run.
    return createBrowserAdapter();
  })();
  return adapterPromise;
}

export function getDb(): Promise<DbAdapter> {
  return initDb();
}

/** Test-only: reset the cached adapter so a fresh init can happen. */
export function __resetDbForTests(): void {
  adapterPromise = null;
}

/** Test-only: inject a fake adapter to bypass init. */
export function __setDbForTests(adapter: DbAdapter): void {
  adapterPromise = Promise.resolve(adapter);
}
