import { describe, expect, it } from 'vitest';
import { ClientStore } from './store';
import type { SqlDriver } from './driver';
import { testDriver } from './test-utils';

/** A pre-v3 cache (schema_version 2): the books table lacks content_updated_at. */
async function v2Cache(): Promise<SqlDriver> {
  const driver = testDriver();
  await driver.exec(`
    create table meta (key text primary key, value text not null);
    create table books (
      id text primary key, title text not null, author text,
      language text not null default 'en', source text not null default 'pdf',
      chapter_count integer not null default 0, created_at text not null, updated_at text not null
    );
    create table chapters (
      book_id text not null, chapter_index integer not null, title text not null,
      paragraphs_json text not null, primary key (book_id, chapter_index)
    );
  `);
  await driver.run(`insert into meta (key, value) values ('schema_version', '2')`);
  return driver;
}

async function seedBook(
  driver: SqlDriver,
  id: string,
  chapterCount: number,
  localChapters: number,
  updatedAt: string,
): Promise<void> {
  await driver.run(
    `insert into books (id, title, language, source, chapter_count, created_at, updated_at)
     values (?, ?, 'en', 'text', ?, 't', ?)`,
    [id, id, chapterCount, updatedAt],
  );
  for (let i = 0; i < localChapters; i++) {
    await driver.run(
      `insert into chapters (book_id, chapter_index, title, paragraphs_json) values (?, ?, 'C', '["x"]')`,
      [id, i],
    );
  }
}

describe('v2 → v3 migration', () => {
  it('backfills only complete books; strands leave content to refetch', async () => {
    const driver = await v2Cache();
    // Complete: metadata says 2 chapters and 2 are local.
    await seedBook(driver, 'complete', 2, 2, 'v2');
    // Stranded by the old bug: metadata advanced to 2 chapters but a content 503
    // left only 1 downloaded — must NOT be cemented as current.
    await seedBook(driver, 'stranded', 2, 1, 'v2');
    // Cloud-only: metadata present, no content yet.
    await seedBook(driver, 'cloud', 1, 0, 'v1');

    const store = new ClientStore(driver);
    await store.init(); // runs the v2 → v3 migration

    const downloaded = await store.downloadedBookIds();
    expect(downloaded.has('complete')).toBe(true);
    expect(downloaded.has('stranded')).toBe(false);
    expect(downloaded.has('cloud')).toBe(false);

    const books = await store.listBooks();
    expect(books.find((b) => b.id === 'complete')!.contentUpdatedAt).toBe('v2');
    expect(books.find((b) => b.id === 'stranded')!.contentUpdatedAt).toBeUndefined();
    expect(books.find((b) => b.id === 'cloud')!.contentUpdatedAt).toBeUndefined();
  });
});
