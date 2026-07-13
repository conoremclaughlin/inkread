/**
 * The five methods a platform must provide to host the client store.
 * Bindings: expo-sqlite (iOS/Android), @sqlite.org/sqlite-wasm in a worker
 * (web + Electron), better-sqlite3 (Node tests). One dialect — SQLite —
 * everywhere; everything above this interface is shared TypeScript.
 */
export type SqlParam = string | number | null | Uint8Array;

export interface SqlDriver {
  /** Run multiple statements (schema DDL). */
  exec(sql: string): Promise<void>;
  /** Run one statement with params, no result. */
  run(sql: string, params?: SqlParam[]): Promise<void>;
  /** Query rows. */
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Query a single row. */
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
}
