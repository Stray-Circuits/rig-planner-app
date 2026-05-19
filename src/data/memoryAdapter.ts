/**
 * Browser-side in-memory SQL adapter.
 *
 * This is a small, intentionally limited SQL interpreter that handles only the
 * statement shapes our repositories emit. It exists so that browser dev mode
 * (running outside the Tauri shell — `pnpm dev`, vitest, Storybook-style
 * previews) gives a real create/read/update/delete experience.
 *
 * It is NOT a general-purpose SQLite. Supported:
 *   - CREATE TABLE / INDEX  (no-op; we don't enforce constraints or FKs)
 *   - INSERT INTO t (cols) VALUES (?, ?, …)
 *   - UPDATE t SET col=?, col2=datetime('now') WHERE col = ?
 *   - DELETE FROM t WHERE col = ?
 *   - SELECT * | col,col FROM t [WHERE col = ?] [ORDER BY col ASC|DESC]
 *
 * Data is persisted to localStorage so reloads survive. The Tauri build never
 * touches this file — it goes straight to tauri-plugin-sql.
 */
import type { DbAdapter } from './db';

type Row = Record<string, unknown>;
type Table = Map<string, Row>;

const STORAGE_KEY = 'rig-planner-memory-db';

/** Rough origin quota assumed by mainstream browsers for localStorage. */
const ASSUMED_QUOTA_BYTES = 5 * 1024 * 1024;

/**
 * Best-effort estimate of how full the memory-adapter's localStorage payload
 * is. Returns 0..1 (fraction of the assumed ~5MB origin quota), or null when
 * localStorage isn't reachable. Lets us proactively warn before a write
 * trips QuotaExceededError. Only meaningful in browser dev mode — the Tauri
 * build never persists here.
 */
export function getLocalStorageUsageFraction(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 0;
    // Each UTF-16 code unit is 2 bytes; lengths are close enough for a
    // sanity check, especially since our writes are pure ASCII JSON +
    // base64 data URLs.
    const bytes = raw.length * 2;
    return Math.min(1, bytes / ASSUMED_QUOTA_BYTES);
  } catch {
    return null;
  }
}

/**
 * True iff an error looks like a localStorage quota failure (the names
 * differ across browsers, hence the broad heuristic).
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return true;
  }
  return /quota/i.test(err.message);
}

/**
 * Shared state used when localStorage is unavailable (jsdom without
 * --localstorage-file, sandboxed iframes, etc.). Lives at module scope so all
 * adapter instances see the same data.
 */
let inMemoryFallback: Map<string, Table> | null = null;

interface InsertMatch {
  table: string;
  columns: string[];
}

interface UpdateMatch {
  table: string;
  sets: { column: string; value: 'param' | 'now' }[];
  whereColumn: string;
}

interface DeleteMatch {
  table: string;
  whereColumn: string;
}

interface SelectMatch {
  table: string;
  columns: string[] | '*';
  whereColumn: string | null;
  orderBy: { column: string; dir: 'ASC' | 'DESC' } | null;
}

function parseInsert(sql: string): InsertMatch | null {
  const m =
    /^\s*INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*;?\s*$/is.exec(
      sql,
    );
  if (!m) return null;
  return {
    table: m[1]!,
    columns: m[2]!.split(',').map((c) => c.trim()),
  };
}

function parseUpdate(sql: string): UpdateMatch | null {
  const m =
    /^\s*UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(\w+)\s*=\s*\?\s*;?\s*$/is.exec(
      sql,
    );
  if (!m) return null;
  const setClause = m[2]!;
  const sets = setClause.split(',').map((piece) => {
    const eq = piece.split('=');
    const column = eq[0]!.trim();
    const rhs = eq.slice(1).join('=').trim();
    const value: 'param' | 'now' = /datetime\s*\(\s*'now'\s*\)/i.test(rhs)
      ? 'now'
      : 'param';
    return { column, value };
  });
  return { table: m[1]!, sets, whereColumn: m[3]! };
}

function parseDelete(sql: string): DeleteMatch | null {
  const m = /^\s*DELETE\s+FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?\s*;?\s*$/i.exec(
    sql,
  );
  if (!m) return null;
  return { table: m[1]!, whereColumn: m[2]! };
}

function parseSelect(sql: string): SelectMatch | null {
  const m =
    /^\s*SELECT\s+(\*|[\w,\s]+)\s+FROM\s+(\w+)(?:\s+WHERE\s+(\w+)\s*=\s*\?)?(?:\s+ORDER\s+BY\s+(\w+)\s*(ASC|DESC)?)?\s*;?\s*$/is.exec(
      sql,
    );
  if (!m) return null;
  const colsRaw = m[1]!.trim();
  const columns: string[] | '*' =
    colsRaw === '*' ? '*' : colsRaw.split(',').map((c) => c.trim());
  return {
    table: m[2]!,
    columns,
    whereColumn: m[3] ?? null,
    orderBy: m[4]
      ? { column: m[4], dir: (m[5] ?? 'ASC').toUpperCase() as 'ASC' | 'DESC' }
      : null,
  };
}

function isNoopStatement(sql: string): boolean {
  return /^\s*(CREATE|DROP)\s+(TABLE|INDEX|VIEW|TRIGGER)/i.test(sql);
}

function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function storageSafe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function hasLocalStorage(): boolean {
  return storageSafe(() => {
    if (typeof localStorage === 'undefined') return false;
    localStorage.getItem(STORAGE_KEY);
    return true;
  }, false);
}

function loadFromStorage(): Map<string, Table> {
  if (!hasLocalStorage()) {
    inMemoryFallback ??= new Map();
    return inMemoryFallback;
  }
  const raw = storageSafe(() => localStorage.getItem(STORAGE_KEY), null);
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, Row[]>;
    const result = new Map<string, Table>();
    for (const [table, rows] of Object.entries(parsed)) {
      const t: Table = new Map();
      for (const row of rows) {
        const idCandidate = row.id ?? row.version ?? row.key;
        if (
          typeof idCandidate !== 'string' &&
          typeof idCandidate !== 'number'
        ) {
          continue;
        }
        const id = String(idCandidate);
        if (id) t.set(id, row);
      }
      result.set(table, t);
    }
    return result;
  } catch {
    return new Map();
  }
}

function saveToStorage(tables: Map<string, Table>): void {
  if (!hasLocalStorage()) {
    inMemoryFallback = tables;
    return;
  }
  const dump: Record<string, Row[]> = {};
  for (const [name, table] of tables) {
    dump[name] = Array.from(table.values());
  }
  storageSafe(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dump));
    return null;
  }, null);
}

/**
 * Compose a synthetic row id for tables whose primary key isn't called "id".
 * For our schema this means `_migrations` (PK = version) and `app_state` (PK
 * = key). Everything else uses `id`.
 */
function rowKey(table: string, row: Row): string {
  if (table === '_migrations') return String(row.version);
  if (table === 'app_state') return String(row.key);
  return String(row.id);
}

export function createMemoryAdapter(): DbAdapter {
  const tables = loadFromStorage();

  function getTable(name: string): Table {
    let t = tables.get(name);
    if (!t) {
      t = new Map();
      tables.set(name, t);
    }
    return t;
  }

  const execute = (sql: string, params: unknown[] = []): Promise<void> => {
    if (isNoopStatement(sql)) return Promise.resolve();

    const insert = parseInsert(sql);
    if (insert) {
      if (insert.columns.length !== params.length) {
        return Promise.reject(
          new Error(
            `MemoryAdapter: ${insert.columns.length} columns but ${params.length} params for ${insert.table}`,
          ),
        );
      }
      const row: Row = {};
      insert.columns.forEach((col, i) => {
        row[col] = params[i];
      });
      // Mirror SQLite's DEFAULT (datetime('now')) for created_at / updated_at
      // when the insert doesn't provide them.
      const now = nowISO();
      if (!('created_at' in row)) row.created_at = now;
      if (!('updated_at' in row)) row.updated_at = now;
      getTable(insert.table).set(rowKey(insert.table, row), row);
      saveToStorage(tables);
      return Promise.resolve();
    }

    const update = parseUpdate(sql);
    if (update) {
      const whereVal = params[params.length - 1];
      const setParams = params.slice(0, params.length - 1);
      const table = getTable(update.table);
      let paramIdx = 0;
      for (const row of table.values()) {
        if (row[update.whereColumn] !== whereVal) continue;
        for (const set of update.sets) {
          if (set.value === 'now') {
            row[set.column] = nowISO();
          } else {
            row[set.column] = setParams[paramIdx];
            paramIdx++;
          }
        }
        // Reset paramIdx if multiple rows match.
        paramIdx = 0;
      }
      saveToStorage(tables);
      return Promise.resolve();
    }

    const del = parseDelete(sql);
    if (del) {
      const table = getTable(del.table);
      const target = params[0];
      const toRemove: string[] = [];
      for (const [key, row] of table) {
        if (row[del.whereColumn] === target) toRemove.push(key);
      }
      for (const key of toRemove) table.delete(key);
      saveToStorage(tables);
      return Promise.resolve();
    }

    return Promise.reject(
      new Error(`MemoryAdapter: unsupported SQL: ${sql.slice(0, 120)}`),
    );
  };

  const select = <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const sel = parseSelect(sql);
    if (!sel) {
      return Promise.reject(
        new Error(`MemoryAdapter: unsupported SELECT: ${sql.slice(0, 120)}`),
      );
    }
    const table = tables.get(sel.table);
    if (!table) return Promise.resolve([] as T[]);
    let rows = Array.from(table.values());
    if (sel.whereColumn !== null) {
      const target = params[0];
      rows = rows.filter((r) => r[sel.whereColumn!] === target);
    }
    if (sel.orderBy) {
      const { column, dir } = sel.orderBy;
      rows.sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av === bv) return 0;
        if (av === undefined || av === null) return dir === 'ASC' ? -1 : 1;
        if (bv === undefined || bv === null) return dir === 'ASC' ? 1 : -1;
        return (av < bv ? -1 : 1) * (dir === 'ASC' ? 1 : -1);
      });
    }
    if (sel.columns === '*') {
      return Promise.resolve(rows.map((r) => ({ ...r })) as T[]);
    }
    const cols = sel.columns;
    return Promise.resolve(
      rows.map((r) => {
        const projected: Row = {};
        for (const c of cols) projected[c] = r[c];
        return projected;
      }) as T[],
    );
  };

  return {
    execute,
    select,
    close: () => Promise.resolve(),
  };
}

/** Test-only: wipe the persisted store. */
export function __clearMemoryAdapterStorage(): void {
  inMemoryFallback = null;
  if (typeof localStorage === 'undefined') return;
  storageSafe(() => {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }, null);
}
