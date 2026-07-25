import type { Annotation } from '@inkread/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ClientStore } from './store';
import { testDriver } from './test-utils';

function annotation(over: Partial<Annotation> & { id: string }): Annotation {
  return {
    bookId: 'b1',
    kind: 'highlight',
    locator: { chapterIndex: 0, start: 0, end: 5 },
    passage: 'Hello',
    color: 'yellow',
    createdAt: '2026-07-20T00:00:00Z',
    ...over,
  };
}

const BOOK = {
  id: 'b1',
  title: 'Test Book',
  author: 'An Author',
  language: 'en',
  source: 'text' as const,
  chapterCount: 2,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-02T00:00:00Z',
};

let store: ClientStore;

beforeEach(async () => {
  store = new ClientStore(testDriver());
  await store.init();
});

describe('ClientStore', () => {
  it('round-trips books with upsert semantics', async () => {
    await store.upsertBooks([BOOK]);
    await store.upsertBooks([{ ...BOOK, title: 'Renamed', updatedAt: '2026-07-03T00:00:00Z' }]);
    const books = await store.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]!.title).toBe('Renamed');
    expect(books[0]!.author).toBe('An Author');
  });

  it('round-trips chapters as JSON paragraphs', async () => {
    await store.upsertBooks([BOOK]);
    await store.replaceChapters('b1', [
      { title: 'One', paragraphs: ['First.', 'Second.'] },
      { title: 'Two', paragraphs: ['Third.'] },
    ]);
    const chapters = await store.getChapters('b1');
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.paragraphs).toEqual(['First.', 'Second.']);
    expect(await store.countChapters('b1')).toBe(2);
  });

  it('reports only books with local content as downloaded', async () => {
    // Two books in the library, but only one has its chapters on-device — the
    // other is cloud-only (metadata synced, content not yet pulled).
    await store.upsertBooks([BOOK, { ...BOOK, id: 'b2', title: 'Cloud only' }]);
    await store.replaceChapters('b1', [{ title: 'One', paragraphs: ['Hi.'] }]);
    const local = await store.downloadedBookIds();
    expect(local.has('b1')).toBe(true);
    expect(local.has('b2')).toBe(false);
  });

  it('round-trips annotations and positions', async () => {
    await store.upsertBooks([BOOK]);
    await store.replaceAnnotations('b1', [
      {
        id: 'a1',
        bookId: 'b1',
        kind: 'note',
        locator: { chapterIndex: 0, start: 3, end: 9 },
        passage: 'passage',
        note: 'a thought',
        color: 'green',
        chapterTitle: 'One',
        createdAt: '2026-07-02T00:00:00Z',
      },
    ]);
    const annotations = await store.listAnnotations('b1');
    expect(annotations[0]!.locator).toEqual({ chapterIndex: 0, start: 3, end: 9 });
    expect(annotations[0]!.note).toBe('a thought');

    await store.upsertPosition({
      bookId: 'b1',
      chapterIndex: 1,
      offset: 128,
      updatedAt: '2026-07-02T01:00:00Z',
    });
    await store.upsertPosition({
      bookId: 'b1',
      chapterIndex: 1,
      offset: 256,
      updatedAt: '2026-07-02T02:00:00Z',
    });
    expect((await store.getPosition('b1'))?.offset).toBe(256);
  });

  it('prunes deleted books with all their data', async () => {
    await store.upsertBooks([BOOK, { ...BOOK, id: 'b2', title: 'Other' }]);
    await store.replaceChapters('b2', [{ title: 'X', paragraphs: ['Y'] }]);
    await store.pruneBooksExcept(['b1']);
    expect((await store.listBooks()).map((b) => b.id)).toEqual(['b1']);
    expect(await store.countChapters('b2')).toBe(0);
  });

  it('stores meta keys', async () => {
    expect(await store.getMeta('last_sync_at')).toBeUndefined();
    await store.setMeta('last_sync_at', '2026-07-13T00:00:00Z');
    expect(await store.getMeta('last_sync_at')).toBe('2026-07-13T00:00:00Z');
  });

  it('replaceChapters is atomic — a failure mid-replace keeps the old chapters', async () => {
    const driver = testDriver();
    const failing: typeof driver = {
      ...driver,
      run: async (sql, params) => {
        // Fail the second insert of the replacement batch (after the delete
        // and first insert succeeded) — simulates a crash mid-refresh.
        if (/insert into chapters/.test(sql) && params?.[1] === 1 && armed) {
          throw new Error('boom');
        }
        return driver.run(sql, params);
      },
    };
    let armed = false;
    const fragile = new ClientStore(failing);
    await fragile.init();
    await fragile.upsertBooks([BOOK]);
    await fragile.replaceChapters('b1', [
      { title: 'Old One', paragraphs: ['Old.'] },
      { title: 'Old Two', paragraphs: ['Older.'] },
    ]);

    armed = true;
    await expect(
      fragile.replaceChapters('b1', [
        { title: 'New One', paragraphs: ['New.'] },
        { title: 'New Two', paragraphs: ['Newer.'] },
      ]),
    ).rejects.toThrow('boom');

    // Rollback must have preserved the previous content — never zero or
    // partial chapters (that dead-ends the reader offline).
    const chapters = await fragile.getChapters('b1');
    expect(chapters.map((c) => c.title)).toEqual(['Old One', 'Old Two']);
  });

  it('replaceChapters prefers a native driver transaction when available', async () => {
    const driver = testDriver();
    let used = 0;
    const withTxn: typeof driver = {
      ...driver,
      transaction: async (fn) => {
        used += 1;
        return fn();
      },
    };
    const txnStore = new ClientStore(withTxn);
    await txnStore.init();
    await txnStore.upsertBooks([BOOK]);
    await txnStore.replaceChapters('b1', [{ title: 'One', paragraphs: ['Hi.'] }]);
    expect(used).toBe(1);
    expect(await txnStore.countChapters('b1')).toBe(1);
  });
});

describe('ClientStore local-first annotations + outbox', () => {
  it('inserts, patches, and deletes a single annotation', async () => {
    await store.insertAnnotation(annotation({ id: 'a1' }));
    expect(await store.listAnnotations('b1')).toHaveLength(1);

    // Adding a note flips kind highlight -> note; a color patch is independent.
    await store.updateAnnotation('a1', { note: 'later', kind: 'note' });
    await store.updateAnnotation('a1', { color: 'blue' });
    const [a] = await store.listAnnotations('b1');
    expect(a!.note).toBe('later');
    expect(a!.kind).toBe('note');
    expect(a!.color).toBe('blue');

    await store.deleteAnnotationById('a1');
    expect(await store.listAnnotations('b1')).toHaveLength(0);
  });

  it('queues and drains outbox entries FIFO', async () => {
    await store.enqueueOutbox({
      op: 'create',
      annotationId: 'a1',
      bookId: 'b1',
      payload: { id: 'a1', color: 'yellow' },
      createdAt: '2026-07-20T00:00:00Z',
    });
    await store.enqueueOutbox({
      op: 'update',
      annotationId: 'a1',
      payload: { color: 'blue' },
      createdAt: '2026-07-20T00:01:00Z',
    });
    const entries = await store.listOutbox();
    expect(entries.map((e) => e.op)).toEqual(['create', 'update']);
    expect(entries[0]!.payload).toEqual({ id: 'a1', color: 'yellow' });
    expect(entries[0]!.bookId).toBe('b1');
    expect(await store.outboxSize()).toBe(2);

    await store.deleteOutboxEntry(entries[0]!.seq);
    expect((await store.listOutbox()).map((e) => e.op)).toEqual(['update']);
  });

  it('replaceAnnotations preserves an offline-created annotation (pending create)', async () => {
    await store.insertAnnotation(annotation({ id: 'local1', passage: 'Mine' }));
    await store.enqueueOutbox({
      op: 'create',
      annotationId: 'local1',
      bookId: 'b1',
      payload: {},
      createdAt: '2026-07-20T00:00:00Z',
    });
    // A pull returns the server's set, which doesn't know about local1 yet.
    await store.replaceAnnotations('b1', [annotation({ id: 'server1', passage: 'Theirs' })]);
    const ids = (await store.listAnnotations('b1')).map((a) => a.id).sort();
    expect(ids).toEqual(['local1', 'server1']);
  });

  it('replaceAnnotations does not revert an unpushed edit (pending update)', async () => {
    // Server copy is yellow; the user recolored it blue offline.
    await store.insertAnnotation(annotation({ id: 'a1', color: 'blue' }));
    await store.enqueueOutbox({
      op: 'update',
      annotationId: 'a1',
      payload: { color: 'blue' },
      createdAt: '2026-07-20T00:00:00Z',
    });
    await store.replaceAnnotations('b1', [annotation({ id: 'a1', color: 'yellow' })]);
    expect((await store.listAnnotations('b1'))[0]!.color).toBe('blue');
  });

  it('replaceAnnotations does not resurrect an offline delete (pending delete)', async () => {
    // Deleted locally; the server still returns it until the delete is pushed.
    await store.enqueueOutbox({
      op: 'delete',
      annotationId: 'a1',
      createdAt: '2026-07-20T00:00:00Z',
    });
    await store.replaceAnnotations('b1', [annotation({ id: 'a1' })]);
    expect(await store.listAnnotations('b1')).toHaveLength(0);
  });

  it('replaceAnnotations fully replaces when nothing is pending', async () => {
    await store.insertAnnotation(annotation({ id: 'old' }));
    await store.replaceAnnotations('b1', [annotation({ id: 'new' })]);
    expect((await store.listAnnotations('b1')).map((a) => a.id)).toEqual(['new']);
  });
});
