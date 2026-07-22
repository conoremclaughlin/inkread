import { beforeEach, describe, expect, it } from 'vitest';
import { ClientStore } from './store';
import { SyncEngine, SyncHttpError } from './sync';
import { jsonResponse, testDriver } from './test-utils';

function makeApi(state: {
  books: Record<string, unknown>[];
  chapters: Record<string, unknown[]>;
  annotations?: Record<string, unknown[]>;
}) {
  const calls: string[] = [];
  const fetcher = async (path: string): Promise<Response> => {
    calls.push(path);
    if (path === '/api/books') return jsonResponse({ books: state.books });
    const content = /^\/api\/books\/([^/?]+)\?include=content$/.exec(path);
    if (content) {
      return jsonResponse({ chapters: state.chapters[content[1]!] ?? [] });
    }
    const annotations = /^\/api\/books\/([^/]+)\/annotations$/.exec(path);
    if (annotations) {
      return jsonResponse({ annotations: state.annotations?.[annotations[1]!] ?? [] });
    }
    if (/\/position$/.test(path)) return jsonResponse({ position: null });
    return jsonResponse({ error: 'not found' }, 404);
  };
  return { fetcher, calls };
}

const BOOK = {
  id: 'b1',
  title: 'Synced Book',
  language: 'en',
  source: 'text',
  chapterCount: 1,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
};

let store: ClientStore;

beforeEach(async () => {
  store = new ClientStore(testDriver());
  await store.init();
});

describe('SyncEngine', () => {
  it('pulls books, chapters, and annotations on first sync', async () => {
    const api = makeApi({
      books: [BOOK],
      chapters: { b1: [{ title: 'One', paragraphs: ['Hello.'] }] },
      annotations: {
        b1: [
          {
            id: 'a1',
            bookId: 'b1',
            kind: 'highlight',
            locator: { chapterIndex: 0, start: 0, end: 5 },
            passage: 'Hello',
            color: 'yellow',
            createdAt: '2026-07-01T01:00:00Z',
          },
        ],
      },
    });
    const result = await new SyncEngine(store, api.fetcher).pull();
    expect(result).toEqual({ books: 1, chaptersRefreshed: 1 });
    expect((await store.getChapters('b1'))[0]!.paragraphs).toEqual(['Hello.']);
    expect(await store.listAnnotations('b1')).toHaveLength(1);
    expect(await store.getMeta('last_sync_at')).toBeDefined();
  });

  it('skips chapter downloads for unchanged books', async () => {
    const api = makeApi({ books: [BOOK], chapters: { b1: [{ title: 'One', paragraphs: ['Hello.'] }] } });
    const engine = new SyncEngine(store, api.fetcher);
    await engine.pull();
    api.calls.length = 0;
    await engine.pull();
    expect(api.calls.filter((c) => c.includes('include=content'))).toHaveLength(0);
  });

  it('refetches chapters when a book was appended to', async () => {
    const api = makeApi({ books: [BOOK], chapters: { b1: [{ title: 'One', paragraphs: ['Hello.'] }] } });
    const engine = new SyncEngine(store, api.fetcher);
    await engine.pull();

    api.calls.length = 0;
    const appended = makeApi({
      books: [{ ...BOOK, chapterCount: 2, updatedAt: '2026-07-02T00:00:00Z' }],
      chapters: {
        b1: [
          { title: 'One', paragraphs: ['Hello.'] },
          { title: 'Two', paragraphs: ['Appended.'] },
        ],
      },
    });
    const result = await new SyncEngine(store, appended.fetcher).pull();
    expect(result.chaptersRefreshed).toBe(1);
    expect(await store.countChapters('b1')).toBe(2);
  });

  it('prunes books deleted on the server', async () => {
    const api = makeApi({ books: [BOOK], chapters: { b1: [{ title: 'One', paragraphs: ['Hello.'] }] } });
    await new SyncEngine(store, api.fetcher).pull();

    const empty = makeApi({ books: [], chapters: {} });
    await new SyncEngine(store, empty.fetcher).pull();
    expect(await store.listBooks()).toEqual([]);
    expect(await store.countChapters('b1')).toBe(0);
  });

  it('throws when the book list is unavailable and leaves the cache intact', async () => {
    const api = makeApi({ books: [BOOK], chapters: { b1: [{ title: 'One', paragraphs: ['Hello.'] }] } });
    await new SyncEngine(store, api.fetcher).pull();

    const offline = async () => jsonResponse({ error: 'offline' }, 503);
    await expect(new SyncEngine(store, offline).pull()).rejects.toThrow('503');
    expect(await store.listBooks()).toHaveLength(1);
    expect((await store.getChapters('b1'))[0]!.paragraphs).toEqual(['Hello.']);
  });

  it('carries the HTTP status on sync failures', async () => {
    const dead = async () => jsonResponse({ error: 'no session' }, 401);
    const error = await new SyncEngine(store, dead).pull().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncHttpError);
    expect((error as SyncHttpError).status).toBe(401);
  });

  it('pullBookContent recovers a book whose content is missing locally', async () => {
    // Book row cached without chapters — the interrupted-first-sync state.
    await store.upsertBooks([BOOK as never]);
    expect(await store.countChapters('b1')).toBe(0);

    const api = makeApi({ books: [BOOK], chapters: { b1: [{ title: 'One', paragraphs: ['Back.'] }] } });
    const chapters = await new SyncEngine(store, api.fetcher).pullBookContent('b1');
    expect(chapters).toHaveLength(1);
    expect((await store.getChapters('b1'))[0]!.paragraphs).toEqual(['Back.']);
  });

  it('pullBookContent leaves the cache untouched when the fetch fails', async () => {
    const api = makeApi({ books: [BOOK], chapters: { b1: [{ title: 'One', paragraphs: ['Hello.'] }] } });
    await new SyncEngine(store, api.fetcher).pull();

    const offline = async () => jsonResponse({ error: 'offline' }, 503);
    const result = await new SyncEngine(store, offline).pullBookContent('b1');
    expect(result).toBeUndefined();
    expect((await store.getChapters('b1'))[0]!.paragraphs).toEqual(['Hello.']);
  });

  it('retries content after a metadata bump whose content fetch failed', async () => {
    // v1 fully synced and marked downloaded.
    const v1 = makeApi({ books: [BOOK], chapters: { b1: [{ title: 'One', paragraphs: ['Hello.'] }] } });
    await new SyncEngine(store, v1.fetcher).pull();
    expect((await store.downloadedBookIds()).has('b1')).toBe(true);

    // v2 metadata arrives, but the content endpoint is down this pull. pull()
    // upserts the new updated_at before fetching content, so the guard against
    // "stale chapters pass as current" is exactly what's under test.
    const v2Meta = { ...BOOK, chapterCount: 2, updatedAt: '2026-07-02T00:00:00Z' };
    const contentDown = async (path: string): Promise<Response> => {
      if (path === '/api/books') return jsonResponse({ books: [v2Meta] });
      if (/include=content/.test(path)) return jsonResponse({ error: 'offline' }, 503);
      if (/\/annotations$/.test(path)) return jsonResponse({ annotations: [] });
      if (/\/position$/.test(path)) return jsonResponse({ position: null });
      return jsonResponse({ error: 'nf' }, 404);
    };
    const bumped = await new SyncEngine(store, contentDown).pull();
    expect(bumped.chaptersRefreshed).toBe(0);
    // Stale v1 chapters remain readable, but the book is NOT current-downloaded.
    expect(await store.countChapters('b1')).toBe(1);
    expect((await store.downloadedBookIds()).has('b1')).toBe(false);

    // Content endpoint recovers: the next pull must re-fetch, not skip forever.
    const v2 = makeApi({
      books: [v2Meta],
      chapters: {
        b1: [
          { title: 'One', paragraphs: ['Hello.'] },
          { title: 'Two', paragraphs: ['World.'] },
        ],
      },
    });
    const healed = await new SyncEngine(store, v2.fetcher).pull();
    expect(v2.calls.some((c) => c.includes('include=content'))).toBe(true);
    expect(healed.chaptersRefreshed).toBe(1);
    expect(await store.countChapters('b1')).toBe(2);
    expect((await store.downloadedBookIds()).has('b1')).toBe(true);
  });
});
