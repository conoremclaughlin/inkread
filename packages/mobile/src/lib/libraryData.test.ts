import Database from 'better-sqlite3';
import { ClientStore, type SqlParam } from '@inkread/client-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Offline-correctness coverage for the reader's write path. The store is a real
 * in-memory ClientStore (same engine as the device's expo-sqlite); apiFetch is
 * a fake we flip online/offline. This is the exact scenario Conor hit on a
 * plane: a highlight made offline must appear at once and sync later — never
 * throw, never vanish.
 */

const h = vi.hoisted(() => ({
  store: undefined as unknown as ClientStore,
  fetch: undefined as unknown as (path: string, init?: RequestInit) => Promise<Response>,
  calls: [] as { path: string; init?: RequestInit }[],
}));

vi.mock('../store/clientStore', () => ({
  getClientStore: async () => h.store,
  resetClientStore: () => {},
}));

vi.mock('./api', () => ({
  apiFetch: (path: string, init?: RequestInit) => {
    h.calls.push({ path, init });
    return h.fetch(path, init);
  },
}));

import {
  createAnnotation,
  deleteAnnotation,
  flushOutbox,
  loadBook,
  persistPosition,
  refreshAnnotations,
  updateAnnotationColor,
  updateAnnotationNote,
} from './libraryData';

const BOOK = {
  id: 'b1',
  title: 'Cached Book',
  language: 'en',
  source: 'text' as const,
  chapterCount: 1,
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
};

function driver() {
  const db = new Database(':memory:');
  return {
    exec: async (sql: string) => {
      db.exec(sql);
    },
    run: async (sql: string, params: SqlParam[] = []) => {
      db.prepare(sql).run(...params);
    },
    all: async <T>(sql: string, params: SqlParam[] = []) =>
      db.prepare(sql).all(...params) as T[],
    get: async <T>(sql: string, params: SqlParam[] = []) =>
      (db.prepare(sql).get(...params) ?? undefined) as T | undefined,
  };
}

const offline = () => Promise.reject(new TypeError('Network request failed'));
const ok = (body: unknown = { ok: true }, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

beforeEach(async () => {
  h.store = new ClientStore(driver());
  await h.store.init();
  h.calls = [];
  h.fetch = offline; // default: on a plane
});

afterEach(async () => {
  // Settle any fire-and-forget flush a write kicked off.
  await flushOutbox().catch(() => undefined);
});

describe('libraryData offline-first annotations', () => {
  it('createAnnotation writes locally and queues, even offline (never throws)', async () => {
    const annotation = await createAnnotation('b1', {
      chapterIndex: 0,
      start: 0,
      end: 5,
      passage: 'Hello',
      color: 'yellow',
      chapterTitle: 'One',
    });
    await flushOutbox(); // the write's own flush attempt — fails offline

    // The bug Conor hit was this line returning empty. It must not.
    const local = await h.store.listAnnotations('b1');
    expect(local.map((a) => a.id)).toEqual([annotation.id]);

    const queued = await h.store.listOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.op).toBe('create');
    expect(queued[0]!.payload).toMatchObject({ id: annotation.id, passage: 'Hello' });
  });

  it('flushes the queued create — with its client id — once back online', async () => {
    const annotation = await createAnnotation('b1', {
      chapterIndex: 0,
      start: 0,
      end: 5,
      passage: 'Hello',
      color: 'yellow',
    });
    await flushOutbox(); // offline: stays queued

    h.fetch = () => ok({ annotation }, 201);
    await flushOutbox();

    expect(await h.store.outboxSize()).toBe(0);
    const post = h.calls.find((c) => c.init?.method === 'POST');
    expect(post?.path).toBe('/api/books/b1/annotations');
    expect(JSON.parse(post!.init!.body as string).id).toBe(annotation.id);
  });

  it('note and colour edits are local-first and queued', async () => {
    h.fetch = () => ok({ annotation: null }, 201);
    const annotation = await createAnnotation('b1', {
      chapterIndex: 0,
      start: 0,
      end: 5,
      passage: 'Hi',
      color: 'yellow',
    });
    await flushOutbox(); // create delivered
    h.calls = [];
    h.fetch = offline; // now offline for the edits

    await updateAnnotationNote(annotation.id, 'a thought');
    await updateAnnotationColor(annotation.id, 'blue');
    await flushOutbox();

    const [a] = await h.store.listAnnotations('b1');
    expect(a!.note).toBe('a thought');
    expect(a!.kind).toBe('note'); // adding a note flips highlight -> note
    expect(a!.color).toBe('blue');
    expect(await h.store.outboxSize()).toBe(2);
  });

  it('deleting an offline-created annotation cancels its queue (no phantom create)', async () => {
    const annotation = await createAnnotation('b1', {
      chapterIndex: 0,
      start: 0,
      end: 5,
      passage: 'Hi',
      color: 'yellow',
    });
    await flushOutbox(); // create stuck in queue (offline)

    h.calls = [];
    await deleteAnnotation(annotation.id);
    await flushOutbox();

    expect(await h.store.listAnnotations('b1')).toHaveLength(0);
    expect(await h.store.outboxSize()).toBe(0);
    // It never reached the server, so nothing was POSTed or DELETEd.
    expect(h.calls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(0);
  });

  it('deleting a synced annotation queues a delete that flushes when online', async () => {
    await h.store.insertAnnotation({
      id: 'server1',
      bookId: 'b1',
      kind: 'highlight',
      locator: { chapterIndex: 0, start: 0, end: 5 },
      passage: 'Hi',
      color: 'yellow',
      createdAt: '2026-07-20T00:00:00Z',
    });

    await deleteAnnotation('server1'); // offline
    await flushOutbox();
    expect(await h.store.listAnnotations('b1')).toHaveLength(0);
    expect((await h.store.listOutbox())[0]!.op).toBe('delete');

    h.fetch = () => ok();
    await flushOutbox();
    expect(await h.store.outboxSize()).toBe(0);
    expect(
      h.calls.some((c) => c.init?.method === 'DELETE' && c.path === '/api/annotations/server1'),
    ).toBe(true);
  });

  it('refreshAnnotations offline serves the local set, including offline creates', async () => {
    const annotation = await createAnnotation('b1', {
      chapterIndex: 0,
      start: 0,
      end: 5,
      passage: 'Hi',
      color: 'yellow',
    });
    await flushOutbox();

    const list = await refreshAnnotations('b1'); // server fetch fails -> local fallback
    expect(list.map((a) => a.id)).toEqual([annotation.id]);
  });

  it('persistPosition saves the reading position locally even offline', async () => {
    // The reading spot must never be lost to a dropped network — it's written to
    // the cache first, then pushed best-effort.
    await persistPosition({ bookId: 'b1', chapterIndex: 2, offset: 400 });
    const pos = await h.store.getPosition('b1');
    expect(pos?.chapterIndex).toBe(2);
    expect(pos?.offset).toBe(400);
    // A best-effort PUT is attempted, and its offline rejection is swallowed.
    expect(h.calls.some((c) => c.init?.method === 'PUT')).toBe(true);
  });

  it('loadBook serves cached chapters offline without hitting the server', async () => {
    await h.store.upsertBooks([BOOK]);
    await h.store.replaceChapters('b1', [{ title: 'One', paragraphs: ['Read me offline.'] }]);
    h.calls = [];

    const loaded = await loadBook('b1');
    expect(loaded?.chapters[0]?.paragraphs).toEqual(['Read me offline.']);
    // Content was already local, so no recovery fetch was needed.
    expect(h.calls).toHaveLength(0);
  });
});
