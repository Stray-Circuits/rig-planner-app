import type { DbAdapter } from '../src/data/db';

export interface ExecuteCall {
  sql: string;
  params: unknown[];
}

interface SelectMatcher {
  pattern: RegExp;
  rowsFor: (params: unknown[]) => unknown[];
}

/**
 * Recording fake adapter for unit tests.
 *
 * - `executes` records every execute call in order.
 * - `selects` records every select call in order.
 * - `mockSelect(pattern, rowsFor)` stages a response for SELECTs matching the
 *   given regex. Order of registration matters: first match wins.
 *
 * This is intentionally simple — it does not actually run SQL. Use it to
 * verify the queries a repository emits, not the database's behaviour.
 */
export interface FakeDb extends DbAdapter {
  executes: ExecuteCall[];
  selects: ExecuteCall[];
  mockSelect: (
    pattern: RegExp,
    rowsFor: (params: unknown[]) => unknown[],
  ) => void;
}

export function createFakeDb(): FakeDb {
  const executes: ExecuteCall[] = [];
  const selects: ExecuteCall[] = [];
  const matchers: SelectMatcher[] = [];

  return {
    executes,
    selects,
    mockSelect: (pattern, rowsFor) => {
      matchers.push({ pattern, rowsFor });
    },
    execute: (sql, params = []) => {
      executes.push({ sql, params });
      return Promise.resolve();
    },
    select: <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
      selects.push({ sql, params });
      for (const m of matchers) {
        if (m.pattern.test(sql)) {
          return Promise.resolve(m.rowsFor(params) as T[]);
        }
      }
      return Promise.resolve([] as T[]);
    },
    close: () => Promise.resolve(),
  };
}
