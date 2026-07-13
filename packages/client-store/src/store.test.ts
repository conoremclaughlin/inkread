import { beforeEach, describe, expect, it } from 'vitest';
import { ClientStore } from './store';
import { testDriver } from './test-utils';

const BOOK = {
  id: 'b1',
  title: 'Test Book',
  author: 'An Author',
  language: 'en',
  source: 'text',
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
});
