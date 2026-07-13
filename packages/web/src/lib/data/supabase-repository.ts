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

  async getChapters(bookId: string): Promise<Chapter[] | undefined> {
    const { data, error } = await this.supabase
      .from('book_content')
      .select('chapters')
      .eq('book_id', bookId)
      .maybeSingle();
    if (error) this.fail('getChapters', error);
    return data ? ((data as { chapters: Chapter[] }).chapters ?? []) : undefined;
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

    const { error: contentError } = await this.supabase.from('book_content').insert({
      book_id: book.id,
      user_id: this.userId,
      chapters: input.chapters,
    });
    if (contentError) {
      await this.supabase.from('books').delete().eq('id', book.id);
      this.fail('createBook(content)', contentError);
    }
    return book;
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
      updated_at: string;
    };
    return {
      bookId: row.book_id,
      chapterIndex: row.chapter_index,
      offset: row.char_offset,
      updatedAt: row.updated_at,
    };
  }

  async savePosition(position: Omit<ReadingPosition, 'updatedAt'>): Promise<void> {
    const { error } = await this.supabase.from('reading_positions').upsert(
      {
        book_id: position.bookId,
        user_id: this.userId,
        chapter_index: position.chapterIndex,
        char_offset: position.offset,
      },
      { onConflict: 'book_id,user_id' },
    );
    if (error) this.fail('savePosition', error);
  }
}
