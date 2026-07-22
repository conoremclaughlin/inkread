import { openDatabaseSync } from 'expo-sqlite';
import { ClientStore, type SqlDriver, type SqlParam } from '@inkread/client-store';

/**
 * iOS/Android binding for the shared client store — the same schema and
 * sync engine as web/desktop, over expo-sqlite. This replaces the app's
 * original ad-hoc local database as sync parity lands.
 */
export function expoSqliteDriver(name = 'inkread-cache.db'): SqlDriver {
  let db = openDatabaseSync(name);

  // iOS can invalidate the SQLite handle while the app is backgrounded (data
  // protection when the device locks, or the OS reclaiming the file handle);
  // the next call then throws on a dead connection. Reopen once and retry so a
  // return-from-background self-heals instead of wedging the app on a blank
  // screen that never recovers. Genuine SQL errors still surface (they throw
  // again after the reopen).
  const guard = <T>(op: () => T): T => {
    try {
      return op();
    } catch {
      try {
        db.closeSync();
      } catch {
        // already dead
      }
      db = openDatabaseSync(name);
      return op();
    }
  };

  // While a transaction is open, per-statement guard retries are suppressed:
  // a reopen-and-retry mid-transaction would run the statement in autocommit
  // on the fresh connection, breaking atomicity. Errors instead abort the
  // whole transaction, which is retried once from the top.
  let inTransaction = false;
  const maybeGuard = <T>(op: () => T): T => (inTransaction ? op() : guard(op));

  return {
    exec: async (sql) => {
      maybeGuard(() => db.execSync(sql));
    },
    run: async (sql, params: SqlParam[] = []) => {
      maybeGuard(() => db.runSync(sql, params as (string | number | null)[]));
    },
    all: async <T>(sql: string, params: SqlParam[] = []) =>
      maybeGuard(() => db.getAllSync<T>(sql, params as (string | number | null)[])),
    get: async <T>(sql: string, params: SqlParam[] = []) =>
      maybeGuard(
        () =>
          (db.getFirstSync<T>(sql, params as (string | number | null)[]) ?? undefined) as
            | T
            | undefined,
      ),
    transaction: async <T>(fn: () => Promise<T>): Promise<T> => {
      const attempt = async (): Promise<T> => {
        inTransaction = true;
        try {
          db.execSync('begin');
          try {
            const result = await fn();
            db.execSync('commit');
            return result;
          } catch (error) {
            try {
              db.execSync('rollback');
            } catch {
              // Connection died — the uncommitted transaction is gone with it.
            }
            throw error;
          }
        } finally {
          inTransaction = false;
        }
      };
      try {
        return await attempt();
      } catch {
        // Stale handle self-heal: reopen once and retry the whole transaction
        // (mirrors guard(); genuine SQL errors fail identically and surface).
        try {
          db.closeSync();
        } catch {
          // already dead
        }
        db = openDatabaseSync(name);
        return attempt();
      }
    },
  };
}

let storePromise: Promise<ClientStore> | undefined;

export function getClientStore(): Promise<ClientStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const store = new ClientStore(expoSqliteDriver());
      await store.init();
      return store;
    })();
    // Never cache a failed init: clear the singleton so the next caller retries
    // with a fresh connection rather than replaying the rejection forever.
    storePromise.catch(() => {
      storePromise = undefined;
    });
  }
  return storePromise;
}

/** Drop the cached store so the next getClientStore() rebuilds the connection. */
export function resetClientStore(): void {
  storePromise = undefined;
}
