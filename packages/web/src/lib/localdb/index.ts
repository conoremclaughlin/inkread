import { ClientStore, SyncEngine, type SqlDriver, type SqlParam } from '@inkread/client-store';

/**
 * Browser/Electron binding for the shared client store: a SqlDriver over
 * the SQLite worker, a lazily-initialized singleton store, and syncNow().
 */

interface WorkerReply {
  id: number;
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}

function workerDriver(): SqlDriver {
  const worker = new Worker(new URL('./sqlite-worker.ts', import.meta.url));
  const pending = new Map<number, { resolve: (rows?: Record<string, unknown>[]) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const { id, ok, rows, error } = event.data;
    const entry = pending.get(id);
    pending.delete(id);
    if (!entry) return;
    if (ok) entry.resolve(rows);
    else entry.reject(new Error(error ?? 'sqlite worker error'));
  };

  const send = (op: string, sql: string, params?: SqlParam[]) =>
    new Promise<Record<string, unknown>[] | undefined>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, sql, params });
    });

  return {
    exec: async (sql) => {
      await send('exec', sql);
    },
    run: async (sql, params) => {
      await send('run', sql, params);
    },
    all: async <T>(sql: string, params?: SqlParam[]) => (await send('all', sql, params) ?? []) as T[],
    get: async <T>(sql: string, params?: SqlParam[]) =>
      ((await send('get', sql, params)) ?? [])[0] as T | undefined,
  };
}

let storePromise: Promise<ClientStore> | undefined;

export function getLocalStore(): Promise<ClientStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const store = new ClientStore(workerDriver());
      await store.init();
      return store;
    })();
  }
  return storePromise;
}

let syncing = false;
let lastSyncAt = 0;
const SYNC_MIN_INTERVAL_MS = 60_000;

/** Pull the latest library into the local cache; cheap to call often. */
export async function syncNow(force = false): Promise<void> {
  if (syncing) return;
  if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return;
  syncing = true;
  try {
    const store = await getLocalStore();
    await new SyncEngine(store, (path) => fetch(path)).pull();
    lastSyncAt = Date.now();
  } finally {
    syncing = false;
  }
}
