import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Annotation,
  AnnotationKind,
  Chapter,
  HighlightColor,
  ReadingPosition,
} from '@inkread/core';
import type {
  BookSummary,
  CreateAnnotationInput,
  CreateBookInput,
  LibraryRepository,
  ReaderPreferences,
} from './repository';

/**
 * Supabase implementation of LibraryRepository. RLS scopes every query to
 * the session user; user_id columns are still written explicitly so inserts
 * pass the with-check policies.
 */

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  language: string;
  source: string;
  chapter_count: number;
  created_at: string;
  updated_at: string;
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

function rowToBook(row: BookRow): BookSummary {
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? undefined,
    language: row.language,
    source: row.source as BookSummary['source'],
    chapterCount: row.chapter_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind as AnnotationKind,
    locator: { chapterIndex: row.chapter_index, start: row.start_offset, end: row.end_offset },
    passage: row.passage,
    note: row.note ?? undefined,
    color: row.color as HighlightColor,
    chapterTitle: row.chapter_title ?? undefined,
    createdAt: row.created_at,
  };
}

export class SupabaseLibraryRepository implements LibraryRepository {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
  ) {}

  private fail(operation: string, error: { message: string }): never {
    throw new Error(`${operation}: ${error.message}`);
  }

  async getPreferences(): Promise<ReaderPreferences> {
    const { data, error } = await this.supabase
      .from('preferences')
      .select('reader')
      .maybeSingle();
    if (error) this.fail('getPreferences', error);
    return ((data as { reader: ReaderPreferences } | null)?.reader ?? {}) as ReaderPreferences;
  }

  async savePreferences(patch: ReaderPreferences): Promise<void> {
    const current = await this.getPreferences();
    const { error } = await this.supabase.from('preferences').upsert(
      { user_id: this.userId, reader: { ...current, ...patch } },
      { onConflict: 'user_id' },
    );
    if (error) this.fail('savePreferences', error);
  }

  async listBooks(): Promise<BookSummary[]> {
    const { data, error } = await this.supabase
      .from('books')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) this.fail('listBooks', error);
    return (data as BookRow[]).map(rowToBook);
  }

  async getBook(bookId: string): Promise<BookSummary | undefined> {
    const { data, error } = await this.supabase
      .from('books')
      .select('*')
      .eq('id', bookId)
      .maybeSingle();
    if (error) this.fail('getBook', error);
    return data ? rowToBook(data as BookRow) : undefined;
  }

  private chapterRows(bookId: string, chapters: Chapter[], startIndex: number) {
    return chapters.map((chapter, i) => ({
      book_id: bookId,
      user_id: this.userId,
      chapter_index: startIndex + i,
      title: chapter.title,
      paragraphs: chapter.paragraphs,
      source_pages: chapter.sourcePages ?? null,
    }));
  }

  async getChapters(bookId: string): Promise<Chapter[] | undefined> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('title, paragraphs, source_pages')
      .eq('book_id', bookId)
      .order('chapter_index');
    if (error) this.fail('getChapters', error);
    const rows = data as { title: string; paragraphs: string[]; source_pages: unknown }[];
    if (rows.length === 0) {
      // Distinguish "no such book" from "book with no content yet".
      const book = await this.getBook(bookId);
      return book ? [] : undefined;
    }
    return rows.map((row) => ({
      title: row.title,
      paragraphs: row.paragraphs,
      sourcePages: (row.source_pages as Chapter['sourcePages']) ?? undefined,
    }));
  }

  async createBook(input: CreateBookInput): Promise<BookSummary> {
    const { data, error } = await this.supabase
      .from('books')
      .insert({
        user_id: this.userId,
        title: input.title,
        author: input.author ?? null,
        language: input.language ?? 'en',
        source: input.source,
        chapter_count: input.chapters.length,
      })
      .select()
      .single();
    if (error) this.fail('createBook', error);
    const book = rowToBook(data as BookRow);

    const { error: contentError } = await this.supabase
      .from('chapters')
      .insert(this.chapterRows(book.id, input.chapters, 0));
    if (contentError) {
      await this.supabase.from('books').delete().eq('id', book.id);
      this.fail('createBook(chapters)', contentError);
    }
    return book;
  }

  async appendChapters(bookId: string, chapters: Chapter[]): Promise<BookSummary> {
    const book = await this.getBook(bookId);
    if (!book) throw new Error('appendChapters: book not found');

    const { error } = await this.supabase
      .from('chapters')
      .insert(this.chapterRows(bookId, chapters, book.chapterCount));
    if (error) this.fail('appendChapters', error);

    const { data, error: updateError } = await this.supabase
      .from('books')
      .update({ chapter_count: book.chapterCount + chapters.length })
      .eq('id', bookId)
      .select()
      .single();
    if (updateError) this.fail('appendChapters(count)', updateError);
    return rowToBook(data as BookRow);
  }

  async insertChapters(bookId: string, chapters: Chapter[], at: number): Promise<BookSummary> {
    const { error } = await this.supabase.rpc('insert_chapters', {
      p_book_id: bookId,
      p_at: at,
      p_chapters: chapters,
    });
    if (error) this.fail('insertChapters', error);
    const book = await this.getBook(bookId);
    if (!book) throw new Error('insertChapters: book not found');
    return book;
  }

  async getChapterTitles(bookId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('chapters')
      .select('title')
      .eq('book_id', bookId)
      .order('chapter_index');
    if (error) this.fail('getChapterTitles', error);
    return (data as { title: string }[]).map((row) => row.title);
  }

  async deleteBook(bookId: string): Promise<void> {
    const { error } = await this.supabase.from('books').delete().eq('id', bookId);
    if (error) this.fail('deleteBook', error);
  }

  async listAnnotations(bookId: string): Promise<Annotation[]> {
    const { data, error } = await this.supabase
      .from('annotations')
      .select('*')
      .eq('book_id', bookId)
      .order('chapter_index')
      .order('start_offset');
    if (error) this.fail('listAnnotations', error);
    return (data as AnnotationRow[]).map(rowToAnnotation);
  }

  async createAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
    const { data, error } = await this.supabase
      .from('annotations')
      .insert({
        user_id: this.userId,
        book_id: input.bookId,
        kind: input.kind,
        chapter_index: input.chapterIndex,
        start_offset: input.start,
        end_offset: input.end,
        passage: input.passage,
        note: input.note ?? null,
        color: input.color,
        chapter_title: input.chapterTitle ?? null,
      })
      .select()
      .single();
    if (error) this.fail('createAnnotation', error);
    return rowToAnnotation(data as AnnotationRow);
  }

  async updateAnnotationNote(annotationId: string, note: string | undefined): Promise<void> {
    const { error } = await this.supabase
      .from('annotations')
      .update({ note: note ?? null, kind: note ? 'note' : 'highlight' })
      .eq('id', annotationId);
    if (error) this.fail('updateAnnotationNote', error);
  }

  async deleteAnnotation(annotationId: string): Promise<void> {
    const { error } = await this.supabase.from('annotations').delete().eq('id', annotationId);
    if (error) this.fail('deleteAnnotation', error);
  }

  async getPosition(bookId: string): Promise<ReadingPosition | undefined> {
    const { data, error } = await this.supabase
      .from('reading_positions')
      .select('*')
      .eq('book_id', bookId)
      .maybeSingle();
    if (error) this.fail('getPosition', error);
    if (!data) return undefined;
    const row = data as {
      book_id: string;
      chapter_index: number;
      char_offset: number;
      furthest_chapter_index: number;
      furthest_offset: number;
      updated_at: string;
    };
    return {
      bookId: row.book_id,
      chapterIndex: row.chapter_index,
      offset: row.char_offset,
      updatedAt: row.updated_at,
      furthest: { chapterIndex: row.furthest_chapter_index, offset: row.furthest_offset },
    };
  }

  async savePosition(position: Omit<ReadingPosition, 'updatedAt'>): Promise<void> {
    // The furthest pointer only moves forward; current moves freely.
    const existing = await this.getPosition(position.bookId);
    const prior = existing?.furthest ?? { chapterIndex: -1, offset: -1 };
    const ahead =
      position.chapterIndex > prior.chapterIndex ||
      (position.chapterIndex === prior.chapterIndex && position.offset > prior.offset);
    const furthest = ahead
      ? { chapterIndex: position.chapterIndex, offset: position.offset }
      : prior;

    const { error } = await this.supabase.from('reading_positions').upsert(
      {
        book_id: position.bookId,
        user_id: this.userId,
        chapter_index: position.chapterIndex,
        char_offset: position.offset,
        furthest_chapter_index: furthest.chapterIndex,
        furthest_offset: furthest.offset,
      },
      { onConflict: 'book_id,user_id' },
    );
    if (error) this.fail('savePosition', error);
  }
}
