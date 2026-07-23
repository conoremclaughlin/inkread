import type { Annotation, Chapter, ReadingPosition } from '@inkread/core';
import type { SqlDriver, SqlParam } from './driver';
import { initSchema } from './schema';

/** Book metadata as cached on clients (mirrors the API's BookSummary). */
export interface CachedBook {
  id: string;
  title: string;
  author?: string;
  language: string;
  source: 'pdf' | 'epub' | 'text';
  chapterCount: number;
  createdAt: string;
  updatedAt: string;
  /**
   * The `updatedAt` whose chapter content is on this device, or undefined when
   * none is (or the local copy is stale for the current version). Local-only
   * bookkeeping — the sync API doesn't send it.
   */
  contentUpdatedAt?: string;
}

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  language: string;
  source: string;
  chapter_count: number;
  created_at: string;
  updated_at: string;
  content_updated_at: string | null;
}

interface AnnotationRow {
  id: string;
  book_id: string;
  kind: string;
  chapter_index: number;
  start_offset: number;
  end_offset: number;
  passage: string;
  note: string | null;
  color: string;
  chapter_title: string | null;
  created_at: string;
}

/** Local read/write surface over the cache tables. */
export class ClientStore {
  constructor(private readonly driver: SqlDriver) {}

  async init(): Promise<void> {
    await initSchema(this.driver);
  }

  // --- meta ---------------------------------------------------------------

  async getMeta(key: string): Promise<string | undefined> {
    const row = await this.driver.get<{ value: string }>(
      'select value from meta where key = ?',
      [key],
    );
    return row?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.driver.run(
      `insert into meta (key, value) values (?, ?)
       on conflict (key) do update set value = excluded.value`,
      [key, value],
    );
  }

  // --- books --------------------------------------------------------------

  async upsertBooks(books: CachedBook[]): Promise<void> {
    for (const book of books) {
      await this.driver.run(
        `insert into books (id, title, author, language, source, chapter_count, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set
           title = excluded.title, author = excluded.author,
           language = excluded.language, source = excluded.source,
           chapter_count = excluded.chapter_count, updated_at = excluded.updated_at`,
        [
          book.id,
          book.title,
          book.author ?? null,
          book.language,
          book.source,
          book.chapterCount,
          book.createdAt,
          book.updatedAt,
        ],
      );
    }
  }

  /** Remove books (and their content) deleted on the server. */
  async pruneBooksExcept(keepIds: string[]): Promise<void> {
    const placeholders = keepIds.map(() => '?').join(', ');
    const where = keepIds.length > 0 ? `where id not in (${placeholders})` : '';
    const params: SqlParam[] = keepIds;
    const stale = await this.driver.all<{ id: string }>(
      `select id from books ${where}`,
      params,
    );
    for (const { id } of stale) {
      await this.driver.run('delete from chapters where book_id = ?', [id]);
      await this.driver.run('delete from annotations where book_id = ?', [id]);
      await this.driver.run('delete from positions where book_id = ?', [id]);
      await this.driver.run('delete from books where id = ?', [id]);
    }
  }

  async listBooks(): Promise<CachedBook[]> {
    const rows = await this.driver.all<BookRow>(
      'select * from books order by created_at desc',
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      author: row.author ?? undefined,
      language: row.language,
      source: row.source as CachedBook['source'],
      chapterCount: row.chapter_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      contentUpdatedAt: row.content_updated_at ?? undefined,
    }));
  }

  async getBook(bookId: string): Promise<CachedBook | undefined> {
    return (await this.listBooks()).find((book) => book.id === bookId);
  }

  // --- chapters -----------------------------------------------------------

  /** Run fn atomically: native driver transaction, else BEGIN/COMMIT. */
  private async atomically(fn: () => Promise<void>): Promise<void> {
    if (this.driver.transaction) {
      await this.driver.transaction(fn);
      return;
    }
    await this.driver.exec('begin');
    try {
      await fn();
      await this.driver.exec('commit');
    } catch (error) {
      await this.driver.exec('rollback').catch(() => undefined);
      throw error;
    }
  }

  async replaceChapters(bookId: string, chapters: Chapter[]): Promise<void> {
    // Atomic delete+insert: a crash mid-replace must never leave a book with
    // zero or partial chapters — that dead-ends the reader on devices that
    // can't re-sync (offline, expired session).
    await this.atomically(async () => {
      await this.driver.run('delete from chapters where book_id = ?', [bookId]);
      for (let index = 0; index < chapters.length; index++) {
        const chapter = chapters[index]!;
        await this.driver.run(
          'insert into chapters (book_id, chapter_index, title, paragraphs_json) values (?, ?, ?, ?)',
          [bookId, index, chapter.title, JSON.stringify(chapter.paragraphs)],
        );
      }
      // Mark the content as current for whatever version the metadata is at now
      // (sync upserts the book row before fetching content). Atomic with the
      // chapter write, so the two never disagree.
      await this.driver.run(
        'update books set content_updated_at = updated_at where id = ?',
        [bookId],
      );
    });
  }

  async getChapters(bookId: string): Promise<Chapter[]> {
    const rows = await this.driver.all<{ title: string; paragraphs_json: string }>(
      'select title, paragraphs_json from chapters where book_id = ? order by chapter_index',
      [bookId],
    );
    return rows.map((row) => ({
      title: row.title,
      paragraphs: JSON.parse(row.paragraphs_json) as string[],
    }));
  }

  async countChapters(bookId: string): Promise<number> {
    const row = await this.driver.get<{ n: number }>(
      'select count(*) as n from chapters where book_id = ?',
      [bookId],
    );
    return row?.n ?? 0;
  }

  /**
   * Ids of books whose *current* content is on this device — the ground truth
   * for "synced locally" vs "only in the cloud". Requires content_updated_at to
   * match updated_at, not merely that some chapters exist: a metadata bump whose
   * content fetch failed leaves stale chapters under a newer updated_at, and
   * that book is not yet downloaded for its current version.
   */
  async downloadedBookIds(): Promise<Set<string>> {
    const rows = await this.driver.all<{ id: string }>(
      'select id from books where content_updated_at is not null and content_updated_at = updated_at',
    );
    return new Set(rows.map((row) => row.id));
  }

  // --- annotations ----------------------------------------------------------

  async replaceAnnotations(bookId: string, annotations: Annotation[]): Promise<void> {
    await this.driver.run('delete from annotations where book_id = ?', [bookId]);
    for (const annotation of annotations) {
      await this.driver.run(
        `insert into annotations
           (id, book_id, kind, chapter_index, start_offset, end_offset, passage, note, color, chapter_title, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          annotation.id,
          annotation.bookId,
          annotation.kind,
          annotation.locator.chapterIndex,
          annotation.locator.start,
          annotation.locator.end,
          annotation.passage,
          annotation.note ?? null,
          annotation.color,
          annotation.chapterTitle ?? null,
          annotation.createdAt,
        ],
      );
    }
  }

  async listAnnotations(bookId: string): Promise<Annotation[]> {
    const rows = await this.driver.all<AnnotationRow>(
      'select * from annotations where book_id = ? order by chapter_index, start_offset',
      [bookId],
    );
    return rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      kind: row.kind as Annotation['kind'],
      locator: {
        chapterIndex: row.chapter_index,
        start: row.start_offset,
        end: row.end_offset,
      },
      passage: row.passage,
      note: row.note ?? undefined,
      color: row.color as Annotation['color'],
      chapterTitle: row.chapter_title ?? undefined,
      createdAt: row.created_at,
    }));
  }

  // --- positions ------------------------------------------------------------

  async upsertPosition(position: ReadingPosition): Promise<void> {
    // Forward-only furthest pointer, mirroring the server's semantics.
    const existing = await this.getPosition(position.bookId);
    const prior = position.furthest ??
      existing?.furthest ?? { chapterIndex: -1, offset: -1 };
    const ahead =
      position.chapterIndex > prior.chapterIndex ||
      (position.chapterIndex === prior.chapterIndex && position.offset > prior.offset);
    const furthest = ahead
      ? { chapterIndex: position.chapterIndex, offset: position.offset }
      : prior;
    await this.driver.run(
      `insert into positions (book_id, chapter_index, char_offset, furthest_chapter_index, furthest_offset, updated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict (book_id) do update set
         chapter_index = excluded.chapter_index,
         char_offset = excluded.char_offset,
         furthest_chapter_index = excluded.furthest_chapter_index,
         furthest_offset = excluded.furthest_offset,
         updated_at = excluded.updated_at`,
      [
        position.bookId,
        position.chapterIndex,
        position.offset,
        furthest.chapterIndex,
        furthest.offset,
        position.updatedAt,
      ],
    );
  }

  async getPosition(bookId: string): Promise<ReadingPosition | undefined> {
    const row = await this.driver.get<{
      book_id: string;
      chapter_index: number;
      char_offset: number;
      furthest_chapter_index: number;
      furthest_offset: number;
      updated_at: string;
    }>('select * from positions where book_id = ?', [bookId]);
    return row
      ? {
          bookId: row.book_id,
          chapterIndex: row.chapter_index,
          offset: row.char_offset,
          updatedAt: row.updated_at,
          furthest: {
            chapterIndex: row.furthest_chapter_index,
            offset: row.furthest_offset,
          },
        }
      : undefined;
  }
}
