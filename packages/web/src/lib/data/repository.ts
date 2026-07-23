import type { Annotation, BookMeta, Chapter, ReadingPosition } from '@inkread/core';

/**
 * The app's data boundary. Route handlers and pages depend on this
 * interface only — the storage provider (today: Supabase/Postgres) is an
 * implementation detail and can be swapped without touching callers.
 */

export interface BookSummary extends BookMeta {
  chapterCount: number;
  updatedAt: string;
}

export interface CreateBookInput {
  title: string;
  author?: string;
  language?: string;
  source: 'pdf' | 'epub' | 'text';
  chapters: Chapter[];
}

export interface CreateAnnotationInput {
  bookId: string;
  kind: 'highlight' | 'note';
  chapterIndex: number;
  start: number;
  end: number;
  passage: string;
  note?: string;
  color: string;
  chapterTitle?: string;
}

/** Reader settings persisted per user; shape evolves freely (jsonb). */
export interface ReaderPreferences {
  theme?: string;
  /** 'auto' follows the OS light/dark setting via lightTheme/darkTheme. */
  themeMode?: 'fixed' | 'auto';
  lightTheme?: string;
  darkTheme?: string;
  pagination?: 'scroll' | 'paged';
  fontSize?: number;
  ttsRate?: number;
  ttsVoice?: string;
  /** Set after the first successful neural-TTS init; enables background warm-up. */
  ttsUsed?: boolean;
}

export interface LibraryRepository {
  getPreferences(): Promise<ReaderPreferences>;
  /** Shallow-merges into the stored preferences. */
  savePreferences(patch: ReaderPreferences): Promise<void>;

  listBooks(): Promise<BookSummary[]>;
  getBook(bookId: string): Promise<BookSummary | undefined>;
  getChapters(bookId: string): Promise<Chapter[] | undefined>;
  createBook(input: CreateBookInput): Promise<BookSummary>;
  /** Adds chapters after the book's current last chapter; annotations untouched. */
  appendChapters(bookId: string, chapters: Chapter[]): Promise<BookSummary>;
  /**
   * Inserts chapters at a position, shifting later chapters and remapping
   * annotation/position anchors atomically.
   */
  insertChapters(bookId: string, chapters: Chapter[], at: number): Promise<BookSummary>;
  /** Chapter titles in order — cheap TOC without the content payload. */
  getChapterTitles(bookId: string): Promise<string[]>;
  deleteBook(bookId: string): Promise<void>;

  listAnnotations(bookId: string): Promise<Annotation[]>;
  createAnnotation(input: CreateAnnotationInput): Promise<Annotation>;
  updateAnnotationNote(annotationId: string, note: string | undefined): Promise<void>;
  updateAnnotationColor(annotationId: string, color: string): Promise<void>;
  deleteAnnotation(annotationId: string): Promise<void>;

  getPosition(bookId: string): Promise<ReadingPosition | undefined>;
  savePosition(position: Omit<ReadingPosition, 'updatedAt'>): Promise<void>;
}
