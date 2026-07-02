import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import type {
  Annotation,
  AnnotationKind,
  BookMeta,
  HighlightColor,
  ReadingPosition,
} from '@inkread/core';

/** Library metadata, annotations, and reading positions. Book content lives on disk. */

export interface BookRecord extends BookMeta {
  chapterCount: number;
}

let db: SQLiteDatabase | undefined;

export function getDb(): SQLiteDatabase {
  if (!db) {
    db = openDatabaseSync('inkread.db');
    migrate(db);
  }
  return db;
}

function migrate(database: SQLiteDatabase): void {
  database.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      language TEXT,
      source TEXT NOT NULL,
      chapter_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      passage TEXT NOT NULL,
      note TEXT,
      color TEXT NOT NULL,
      chapter_title TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_annotations_book ON annotations(book_id, chapter_index, start);
    CREATE TABLE IF NOT EXISTS positions (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      chapter_index INTEGER NOT NULL,
      offset INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  language: string | null;
  source: string;
  chapter_count: number;
  created_at: string;
}

function rowToBook(row: BookRow): BookRecord {
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? undefined,
    language: row.language ?? undefined,
    source: row.source as BookMeta['source'],
    chapterCount: row.chapter_count,
    createdAt: row.created_at,
  };
}

export function insertBook(book: BookRecord): void {
  getDb().runSync(
    'INSERT INTO books (id, title, author, language, source, chapter_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    book.id,
    book.title,
    book.author ?? null,
    book.language ?? null,
    book.source,
    book.chapterCount,
    book.createdAt,
  );
}

export function listBooks(): BookRecord[] {
  return getDb()
    .getAllSync<BookRow>('SELECT * FROM books ORDER BY created_at DESC')
    .map(rowToBook);
}

export function getBook(id: string): BookRecord | undefined {
  const row = getDb().getFirstSync<BookRow>('SELECT * FROM books WHERE id = ?', id);
  return row ? rowToBook(row) : undefined;
}

export function deleteBook(id: string): void {
  const database = getDb();
  database.withTransactionSync(() => {
    database.runSync('DELETE FROM annotations WHERE book_id = ?', id);
    database.runSync('DELETE FROM positions WHERE book_id = ?', id);
    database.runSync('DELETE FROM books WHERE id = ?', id);
  });
}

interface AnnotationRow {
  id: string;
  book_id: string;
  kind: string;
  chapter_index: number;
  start: number;
  end: number;
  passage: string;
  note: string | null;
  color: string;
  chapter_title: string | null;
  created_at: string;
}

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind as AnnotationKind,
    locator: { chapterIndex: row.chapter_index, start: row.start, end: row.end },
    passage: row.passage,
    note: row.note ?? undefined,
    color: row.color as HighlightColor,
    chapterTitle: row.chapter_title ?? undefined,
    createdAt: row.created_at,
  };
}

export function insertAnnotation(annotation: Annotation): void {
  getDb().runSync(
    'INSERT INTO annotations (id, book_id, kind, chapter_index, start, end, passage, note, color, chapter_title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
  );
}

export function updateAnnotationNote(id: string, note: string | undefined): void {
  getDb().runSync(
    "UPDATE annotations SET note = ?, kind = CASE WHEN ? IS NULL THEN 'highlight' ELSE 'note' END WHERE id = ?",
    note ?? null,
    note ?? null,
    id,
  );
}

export function deleteAnnotation(id: string): void {
  getDb().runSync('DELETE FROM annotations WHERE id = ?', id);
}

export function listAnnotations(bookId: string, chapterIndex?: number): Annotation[] {
  const rows =
    chapterIndex === undefined
      ? getDb().getAllSync<AnnotationRow>(
          'SELECT * FROM annotations WHERE book_id = ? ORDER BY chapter_index, start',
          bookId,
        )
      : getDb().getAllSync<AnnotationRow>(
          'SELECT * FROM annotations WHERE book_id = ? AND chapter_index = ? ORDER BY start',
          bookId,
          chapterIndex,
        );
  return rows.map(rowToAnnotation);
}

export function savePosition(position: ReadingPosition): void {
  getDb().runSync(
    'INSERT INTO positions (book_id, chapter_index, offset, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(book_id) DO UPDATE SET chapter_index = excluded.chapter_index, offset = excluded.offset, updated_at = excluded.updated_at',
    position.bookId,
    position.chapterIndex,
    position.offset,
    position.updatedAt,
  );
}

export function getPosition(bookId: string): ReadingPosition | undefined {
  const row = getDb().getFirstSync<{
    book_id: string;
    chapter_index: number;
    offset: number;
    updated_at: string;
  }>('SELECT * FROM positions WHERE book_id = ?', bookId);
  return row
    ? {
        bookId: row.book_id,
        chapterIndex: row.chapter_index,
        offset: row.offset,
        updatedAt: row.updated_at,
      }
    : undefined;
}
