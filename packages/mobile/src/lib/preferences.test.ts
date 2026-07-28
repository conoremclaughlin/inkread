import Database from 'better-sqlite3';
import { ClientStore, type SqlParam } from '@inkread/client-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Opening a book must never block on the network. The bug: with internet up but
 * the API host unreachable, fetch hangs until the request timeout, so awaiting
 * the preferences fetch stalled the reader — while airplane mode failed fast and
 * "just worked". loadPreferences must return the cached copy immediately and
 * refresh in the background.
 */

const h = vi.hoisted(() => ({
  store: undefined as unknown as ClientStore,
  fetch: undefined as unknown as (path: string, init?: RequestInit) => Promise<Response>,
}));

vi.mock('../store/clientStore', () => ({
  getClientStore: async () => h.store,
  resetClientStore: () => {},
}));

vi.mock('./api', () => ({
  apiFetch: (path: string, init?: RequestInit) => h.fetch(path, init),
}));

import { loadPreferences, savePreferences } from './preferences';

function driver() {
  const db = new Database(':memory:');
  return {
    exec: async (sql: string) => {
      db.exec(sql);
    },
    run: async (sql: string, params: SqlParam[] = []) => {
      db.prepare(sql).run(...params);
    },
    all: async <T>(sql: string, params: SqlParam[] = []) => db.prepare(sql).all(...params) as T[],
    get: async <T>(sql: string, params: SqlParam[] = []) =>
      (db.prepare(sql).get(...params) ?? undefined) as T | undefined,
  };
}

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }));
const hangsForever = () => new Promise<Response>(() => undefined);

beforeEach(async () => {
  h.store = new ClientStore(driver());
  await h.store.init();
  h.fetch = hangsForever;
});

afterEach(() => vi.clearAllMocks());

describe('loadPreferences', () => {
  it('returns cached prefs immediately even when the server never responds', async () => {
    await savePreferences({ theme: 'midnight', fontSize: 21 }); // seeds the cache
    h.fetch = hangsForever; // internet up, API host dead → fetch hangs

    // The bug was this awaiting the hung fetch. It must resolve on the cache.
    const prefs = await loadPreferences();
    expect(prefs).toEqual({ theme: 'midnight', fontSize: 21 });
  });

  it('returns defaults immediately when there is no cache and no server', async () => {
    h.fetch = hangsForever;
    expect(await loadPreferences()).toEqual({});
  });

  it('refreshes the cache from the server in the background', async () => {
    await savePreferences({ theme: 'paper' });
    h.fetch = () => ok({ preferences: { theme: 'sepia', ttsRate: 1.25 } });

    const immediate = await loadPreferences();
    expect(immediate).toEqual({ theme: 'paper' }); // returns cached first

    // The background refresh merges server over cache; visible on next load.
    await vi.waitFor(async () => {
      expect(await loadPreferences()).toEqual({ theme: 'sepia', ttsRate: 1.25 });
    });
  });
});
