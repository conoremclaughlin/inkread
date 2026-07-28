import Database from 'better-sqlite3';
import { ClientStore, type SqlParam } from '@inkread/client-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ store: undefined as unknown as ClientStore }));

vi.mock('../store/clientStore', () => ({
  getClientStore: async () => h.store,
  resetClientStore: () => {},
}));

import {
  clearLastError,
  formatError,
  getLastError,
  installGlobalErrorHandler,
  recordError,
} from './errorLog';

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

beforeEach(async () => {
  h.store = new ClientStore(driver());
  await h.store.init();
});

afterEach(() => {
  delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  vi.restoreAllMocks();
});

describe('formatError', () => {
  it('normalizes an Error with its message and stack', () => {
    const err = new Error('boom');
    const rec = formatError(err, 'render', '2026-07-27T00:00:00Z');
    expect(rec.message).toBe('boom');
    expect(rec.stack).toContain('boom');
    expect(rec.context).toBe('render');
    expect(rec.at).toBe('2026-07-27T00:00:00Z');
  });

  it('handles thrown strings and objects', () => {
    expect(formatError('just a string', undefined, 't').message).toBe('just a string');
    expect(formatError({ code: 42 }, undefined, 't').message).toBe('{"code":42}');
  });
});

describe('recordError / getLastError / clearLastError', () => {
  it('round-trips the last error through the store', async () => {
    await recordError(new Error('offline crash'), 'uncaught');
    const rec = await getLastError();
    expect(rec?.message).toBe('offline crash');
    expect(rec?.context).toBe('uncaught');

    await clearLastError();
    expect(await getLastError()).toBeUndefined();
  });
});

describe('installGlobalErrorHandler', () => {
  it('returns false when ErrorUtils is absent', () => {
    expect(installGlobalErrorHandler(() => {})).toBe(false);
  });

  it('routes an uncaught error to onError, storage, and the previous handler', async () => {
    const previous = vi.fn();
    let installed: ((error: unknown, isFatal?: boolean) => void) | undefined;
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (fn: (error: unknown, isFatal?: boolean) => void) => {
        installed = fn;
      },
    };

    const onError = vi.fn();
    expect(installGlobalErrorHandler(onError)).toBe(true);

    const err = new Error('kaboom');
    installed!(err, true);

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'kaboom', context: 'fatal' }));
    expect(previous).toHaveBeenCalledWith(err, true); // chained
    await vi.waitFor(async () => {
      expect((await getLastError())?.message).toBe('kaboom');
    });
  });
});
