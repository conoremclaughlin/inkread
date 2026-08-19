import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Annotation,
  AnnotationKind,
  BookVisibility,
  Chapter,
  ChapterRecording,
  Comment,
  HighlightColor,
  PublicationStatus,
  PurchaseResult,
  ReadChapter,
  ReadingPosition,
  Speaker,
  VoiceCast,
  VoiceRule,
  Wallet,
} from '@inkread/core';
import type {
  BookSummary,
  CreateAnnotationInput,
  CreateChapterRecordingInput,
  CreateCommentInput,
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
  visibility: string;
  status: string;
  free_chapter_count: number;
  coins_per_chapter: number;
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
    visibility: (row.visibility as BookVisibility) ?? 'private',
    status: (row.status as PublicationStatus) ?? 'ongoing',
    freeChapterCount: row.free_chapter_count ?? 0,
    coinsPerChapter: row.coins_per_chapter ?? 0,
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

interface CommentRow {
  id: string;
  book_id: string;
  user_id: string;
  chapter_index: number;
  author_name: string | null;
  body: string;
  created_at: string;
}

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterIndex: row.chapter_index,
    authorId: row.user_id,
    authorName: row.author_name ?? undefined,
    body: row.body,
    createdAt: row.created_at,
  };
}

interface RecordingRow {
  id: string;
  book_id: string;
  chapter_index: number;
  storage_path: string;
  duration_seconds: number | null;
  created_at: string;
}

function rowToRecording(row: RecordingRow): ChapterRecording {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterIndex: row.chapter_index,
    storagePath: row.storage_path,
    durationSeconds: row.duration_seconds ?? undefined,
    createdAt: row.created_at,
  };
}

interface PurchaseRow {
  unlocked: number[] | null;
  coins_spent: number;
  balance: number;
}

function rowToPurchase(row: PurchaseRow): PurchaseResult {
  return {
    unlocked: row.unlocked ?? [],
    coinsSpent: row.coins_spent,
    balance: row.balance,
  };
}

interface ReadChapterRow {
  chapter_index: number;
  title: string;
  paragraphs: string[] | null;
  locked: boolean;
  coin_cost: number;
}

function rowToReadChapter(row: ReadChapterRow): ReadChapter {
  return {
    chapterIndex: row.chapter_index,
    title: row.title,
    paragraphs: row.paragraphs ?? undefined,
    locked: row.locked,
    coinCost: row.coin_cost,
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
    // Scope to the owner explicitly: books now carry a public-read RLS policy
    // (for the discovery site), so relying on RLS alone would surface everyone
    // else's published books in this personal library.
    const { data, error } = await this.supabase
      .from('books')
      .select('*')
      .eq('user_id', this.userId)
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
    const row = {
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
      ...(input.id ? { id: input.id } : {}),
    };
    // A client-supplied id upserts so a retried offline create is idempotent
    // (RLS still scopes the row to this user). Without one, insert and let the
    // server assign the id.
    const query = input.id
      ? this.supabase.from('annotations').upsert(row, { onConflict: 'id' })
      : this.supabase.from('annotations').insert(row);
    const { data, error } = await query.select().single();
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

  async updateAnnotationColor(annotationId: string, color: string): Promise<void> {
    const { error } = await this.supabase
      .from('annotations')
      .update({ color })
      .eq('id', annotationId);
    if (error) this.fail('updateAnnotationColor', error);
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

  async listComments(bookId: string, chapterIndex: number): Promise<Comment[]> {
    const { data, error } = await this.supabase
      .from('comments')
      .select('*')
      .eq('book_id', bookId)
      .eq('chapter_index', chapterIndex)
      .order('created_at', { ascending: true });
    if (error) this.fail('listComments', error);
    return (data as CommentRow[]).map(rowToComment);
  }

  async createComment(input: CreateCommentInput): Promise<Comment> {
    // Denormalize a display name from the signed-in user's email local-part.
    const { data: userData } = await this.supabase.auth.getUser();
    const authorName = userData.user?.email?.split('@')[0] ?? null;
    const { data, error } = await this.supabase
      .from('comments')
      .insert({
        book_id: input.bookId,
        user_id: this.userId,
        chapter_index: input.chapterIndex,
        author_name: authorName,
        body: input.body.trim(),
      })
      .select()
      .single();
    if (error) this.fail('createComment', error);
    return rowToComment(data as CommentRow);
  }

  async deleteComment(commentId: string): Promise<void> {
    // RLS enforces author-only deletion.
    const { error } = await this.supabase.from('comments').delete().eq('id', commentId);
    if (error) this.fail('deleteComment', error);
  }

  async voteOnComment(commentId: string, value: 1 | -1 | 0): Promise<void> {
    // A trigger keeps comments.up_count/down_count (and the generated score) in
    // step; RLS allows a vote only on a comment the user can actually see.
    if (value === 0) {
      const { error } = await this.supabase
        .from('comment_votes')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_id', this.userId);
      if (error) this.fail('voteOnComment(clear)', error);
      return;
    }
    const { error } = await this.supabase.from('comment_votes').upsert(
      { comment_id: commentId, user_id: this.userId, value },
      { onConflict: 'comment_id,user_id' },
    );
    if (error) this.fail('voteOnComment', error);
  }

  async listMyVotes(commentIds: string[]): Promise<Record<string, 1 | -1>> {
    if (commentIds.length === 0) return {};
    const { data, error } = await this.supabase
      .from('comment_votes')
      .select('comment_id, value')
      .eq('user_id', this.userId)
      .in('comment_id', commentIds);
    if (error) this.fail('listMyVotes', error);
    const votes: Record<string, 1 | -1> = {};
    for (const row of data as { comment_id: string; value: number }[]) {
      votes[row.comment_id] = row.value === 1 ? 1 : -1;
    }
    return votes;
  }

  async setBookPublication(
    bookId: string,
    patch: {
      visibility?: BookVisibility;
      status?: PublicationStatus;
      freeChapterCount?: number;
      coinsPerChapter?: number;
    },
  ): Promise<BookSummary> {
    // RLS: only the book owner may update.
    const update: Record<string, string | number> = {};
    if (patch.visibility) update.visibility = patch.visibility;
    if (patch.status) update.status = patch.status;
    // 0 is a meaningful value here (a free head of 0, or a free book), so guard
    // on undefined rather than falsiness.
    if (patch.freeChapterCount !== undefined) {
      update.free_chapter_count = Math.max(0, Math.floor(patch.freeChapterCount));
    }
    if (patch.coinsPerChapter !== undefined) {
      update.coins_per_chapter = Math.max(0, Math.floor(patch.coinsPerChapter));
    }
    const { data, error } = await this.supabase
      .from('books')
      .update(update)
      .eq('id', bookId)
      .select()
      .single();
    if (error) this.fail('setBookPublication', error);
    return rowToBook(data as BookRow);
  }

  // --- Coins & entitlements ---------------------------------------------------

  async getWallet(): Promise<Wallet> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('coin_balance')
      .eq('user_id', this.userId)
      .maybeSingle();
    if (error) this.fail('getWallet', error);
    return { balance: (data as { coin_balance: number } | null)?.coin_balance ?? 0 };
  }

  async topUpDemo(amount: number): Promise<number> {
    const { data, error } = await this.supabase.rpc('grant_demo_coins', { p_amount: amount });
    if (error) this.fail('topUpDemo', error);
    return (data as number) ?? 0;
  }

  async listMyUnlocks(bookId: string): Promise<number[]> {
    // RLS returns only this user's unlock rows.
    const { data, error } = await this.supabase
      .from('chapter_unlocks')
      .select('chapter_index')
      .eq('book_id', bookId)
      .order('chapter_index');
    if (error) this.fail('listMyUnlocks', error);
    return (data as { chapter_index: number }[]).map((r) => r.chapter_index);
  }

  async unlockChapter(bookId: string, chapterIndex: number): Promise<PurchaseResult> {
    const { data, error } = await this.supabase
      .rpc('unlock_chapter', { p_book_id: bookId, p_chapter_index: chapterIndex })
      .single();
    if (error) this.fail('unlockChapter', error);
    return rowToPurchase(data as PurchaseRow);
  }

  async unlockBook(bookId: string): Promise<PurchaseResult> {
    const { data, error } = await this.supabase
      .rpc('unlock_book', { p_book_id: bookId })
      .single();
    if (error) this.fail('unlockBook', error);
    return rowToPurchase(data as PurchaseRow);
  }

  async readChapter(bookId: string, chapterIndex: number): Promise<ReadChapter | undefined> {
    const { data, error } = await this.supabase
      .rpc('read_public_chapter', { p_book_id: bookId, p_chapter_index: chapterIndex })
      .maybeSingle();
    if (error) this.fail('readChapter', error);
    return data ? rowToReadChapter(data as ReadChapterRow) : undefined;
  }

  async getVoiceCast(bookId: string): Promise<VoiceCast | undefined> {
    const { data, error } = await this.supabase
      .from('voice_casts')
      .select('speakers, rules, default_speaker_id')
      .eq('book_id', bookId)
      .maybeSingle();
    if (error) this.fail('getVoiceCast', error);
    if (!data) return undefined;
    const row = data as {
      speakers: Speaker[] | null;
      rules: VoiceRule[] | null;
      default_speaker_id: string | null;
    };
    return {
      bookId,
      speakers: row.speakers ?? [],
      rules: row.rules ?? [],
      defaultSpeakerId: row.default_speaker_id ?? '',
    };
  }

  async saveVoiceCast(cast: VoiceCast): Promise<void> {
    // RLS: only the book owner may write.
    const { error } = await this.supabase.from('voice_casts').upsert(
      {
        book_id: cast.bookId,
        updated_by: this.userId,
        speakers: cast.speakers,
        rules: cast.rules,
        default_speaker_id: cast.defaultSpeakerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'book_id' },
    );
    if (error) this.fail('saveVoiceCast', error);
  }

  async getChapterRecording(
    bookId: string,
    chapterIndex: number,
  ): Promise<ChapterRecording | undefined> {
    const { data, error } = await this.supabase
      .from('chapter_recordings')
      .select('*')
      .eq('book_id', bookId)
      .eq('chapter_index', chapterIndex)
      .maybeSingle();
    if (error) this.fail('getChapterRecording', error);
    return data ? rowToRecording(data as RecordingRow) : undefined;
  }

  async listChapterRecordings(bookId: string): Promise<ChapterRecording[]> {
    const { data, error } = await this.supabase
      .from('chapter_recordings')
      .select('*')
      .eq('book_id', bookId)
      .order('chapter_index');
    if (error) this.fail('listChapterRecordings', error);
    return (data as RecordingRow[]).map(rowToRecording);
  }

  async saveChapterRecording(input: CreateChapterRecordingInput): Promise<ChapterRecording> {
    // RLS: only the book owner may write. Upserts per (book, chapter).
    const { data, error } = await this.supabase
      .from('chapter_recordings')
      .upsert(
        {
          book_id: input.bookId,
          chapter_index: input.chapterIndex,
          created_by: this.userId,
          storage_path: input.storagePath,
          duration_seconds: input.durationSeconds ?? null,
        },
        { onConflict: 'book_id,chapter_index' },
      )
      .select()
      .single();
    if (error) this.fail('saveChapterRecording', error);
    return rowToRecording(data as RecordingRow);
  }
}
