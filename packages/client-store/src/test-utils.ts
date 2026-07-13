import Database from 'better-sqlite3';
import type { SqlDriver, SqlParam } from './driver';

/** Node test driver over better-sqlite3 (in-memory). */
export function testDriver(): SqlDriver {
  const db = new Database(':memory:');
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params: SqlParam[] = []) => {
      db.prepare(sql).run(...params);
    },
    all: async <T>(sql: string, params: SqlParam[] = []) =>
      db.prepare(sql).all(...params) as T[],
    get: async <T>(sql: string, params: SqlParam[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
  };
}

/** Minimal Response-alike for sync tests. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
