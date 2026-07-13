/**
 * Web Worker hosting SQLite (official WASM build) persisted to OPFS via the
 * SAH-pool VFS — durable local storage in both browsers and Electron with
 * no COOP/COEP requirements.
 *
 * Protocol: {id, op: 'exec'|'run'|'all'|'get', sql, params} →
 *           {id, ok: true, rows?} | {id, ok: false, error}
 */
interface Request {
  id: number;
  op: 'exec' | 'run' | 'all' | 'get';
  sql: string;
  params?: unknown[];
}

type Db = {
  exec(options: { sql: string; bind?: unknown[]; rowMode?: string; returnValue?: string }): unknown;
};

const ready: Promise<Db> = (async () => {
  // Loaded from /public at runtime (see scripts/copy-sqlite.mjs) — the
  // package's own module graph contains dynamic worker URLs Turbopack
  // cannot resolve, so it must stay out of the bundle.
  const runtimeUrl = '/sqlite/index.mjs';
  const init = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ runtimeUrl)) as {
    default: (options?: Record<string, unknown>) => Promise<{
      installOpfsSAHPoolVfs(options: { name: string }): Promise<{
        OpfsSAHPoolDb: new (path: string) => Db;
      }>;
    }>;
  };
  const sqlite3 = await init.default();
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'inkread' });
  return new pool.OpfsSAHPoolDb('/inkread.db');
})();

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, op, sql, params } = event.data;
  try {
    const db = await ready;
    if (op === 'exec') {
      db.exec({ sql });
      self.postMessage({ id, ok: true });
      return;
    }
    if (op === 'run') {
      db.exec({ sql, bind: params });
      self.postMessage({ id, ok: true });
      return;
    }
    const rows = db.exec({
      sql,
      bind: params,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Record<string, unknown>[];
    self.postMessage({ id, ok: true, rows: op === 'get' ? rows.slice(0, 1) : rows });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
