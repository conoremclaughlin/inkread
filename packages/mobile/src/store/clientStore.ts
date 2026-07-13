import { openDatabaseSync } from 'expo-sqlite';
import { ClientStore, type SqlDriver, type SqlParam } from '@inkread/client-store';

/**
 * iOS/Android binding for the shared client store — the same schema and
 * sync engine as web/desktop, over expo-sqlite. This replaces the app's
 * original ad-hoc local database as sync parity lands.
 */
export function expoSqliteDriver(name = 'inkread-cache.db'): SqlDriver {
  const db = openDatabaseSync(name);
  return {
    exec: async (sql) => {
      db.execSync(sql);
    },
    run: async (sql, params: SqlParam[] = []) => {
      db.runSync(sql, params as (string | number | null)[]);
    },
    all: async <T>(sql: string, params: SqlParam[] = []) =>
      db.getAllSync<T>(sql, params as (string | number | null)[]),
    get: async <T>(sql: string, params: SqlParam[] = []) =>
      (db.getFirstSync<T>(sql, params as (string | number | null)[]) ?? undefined) as
        | T
        | undefined,
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
  }
  return storePromise;
}
