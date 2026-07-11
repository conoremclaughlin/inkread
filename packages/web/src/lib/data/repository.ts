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

export interface LibraryRepository {
  listBooks(): Promise<BookSummary[]>;
  getBook(bookId: string): Promise<BookSummary | undefined>;
  getChapters(bookId: string): Promise<Chapter[] | undefined>;
  createBook(input: CreateBookInput): Promise<BookSummary>;
  deleteBook(bookId: string): Promise<void>;

  listAnnotations(bookId: string): Promise<Annotation[]>;
  createAnnotation(input: CreateAnnotationInput): Promise<Annotation>;
  updateAnnotationNote(annotationId: string, note: string | undefined): Promise<void>;
  deleteAnnotation(annotationId: string): Promise<void>;

  getPosition(bookId: string): Promise<ReadingPosition | undefined>;
  savePosition(position: Omit<ReadingPosition, 'updatedAt'>): Promise<void>;
}
