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

  return {
    exec: async (sql) => {
      guard(() => db.execSync(sql));
    },
    run: async (sql, params: SqlParam[] = []) => {
      guard(() => db.runSync(sql, params as (string | number | null)[]));
    },
    all: async <T>(sql: string, params: SqlParam[] = []) =>
      guard(() => db.getAllSync<T>(sql, params as (string | number | null)[])),
    get: async <T>(sql: string, params: SqlParam[] = []) =>
      guard(
        () =>
          (db.getFirstSync<T>(sql, params as (string | number | null)[]) ?? undefined) as
            | T
            | undefined,
      ),
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
