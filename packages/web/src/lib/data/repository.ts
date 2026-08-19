import type {
  Annotation,
  BookMeta,
  BookVisibility,
  Chapter,
  ChapterRecording,
  Comment,
  PublicationStatus,
  PurchaseResult,
  ReadChapter,
  ReadingPosition,
  VoiceCast,
  Wallet,
} from '@inkread/core';

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
  /**
   * Client-supplied id. Offline-first clients generate the id up front so a
   * highlight has a stable identity before it reaches the server; delivering
   * the same id twice (a retried write) upserts rather than duplicates. Omitted
   * by online clients, in which case the server assigns one.
   */
  id?: string;
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

  /** Reader comments on a chapter, oldest first. */
  listComments(bookId: string, chapterIndex: number): Promise<Comment[]>;
  createComment(input: CreateCommentInput): Promise<Comment>;
  deleteComment(commentId: string): Promise<void>;
  /** Cast (+1 / −1) or clear (0) the current user's vote on a comment. */
  voteOnComment(commentId: string, value: 1 | -1 | 0): Promise<void>;
  /** The current user's own vote on each given comment (their rows only). */
  listMyVotes(commentIds: string[]): Promise<Record<string, 1 | -1>>;

  /**
   * Owner-only: publish/unpublish a book, set its serialization status, and set
   * its pricing policy (free head + per-chapter coin price). All fields optional.
   */
  setBookPublication(
    bookId: string,
    patch: {
      visibility?: BookVisibility;
      status?: PublicationStatus;
      freeChapterCount?: number;
      coinsPerChapter?: number;
    },
  ): Promise<BookSummary>;

  // --- Coins & entitlements ---------------------------------------------------

  /** The signed-in reader's coin wallet balance. */
  getWallet(): Promise<Wallet>;
  /** Add demo coins to the wallet (no real charge); returns the new balance. */
  topUpDemo(amount: number): Promise<number>;
  /** Chapter indices the reader has already unlocked for a book. */
  listMyUnlocks(bookId: string): Promise<number[]>;
  /** Buy a single chapter. Idempotent — a free/owned chapter costs nothing. */
  unlockChapter(bookId: string, chapterIndex: number): Promise<PurchaseResult>;
  /** Buy every still-locked paid chapter of a book at once (batch unlock). */
  unlockBook(bookId: string): Promise<PurchaseResult>;
  /**
   * Read a chapter through the entitlement gate. `paragraphs` is present only
   * when entitled (owner, free head, or unlocked); otherwise it comes back
   * `locked` with the coin cost so the caller can render a paywall.
   */
  readChapter(bookId: string, chapterIndex: number): Promise<ReadChapter | undefined>;

  /** The book's multi-voice cast, or undefined if none has been set up. */
  getVoiceCast(bookId: string): Promise<VoiceCast | undefined>;
  /** Upsert the cast (book owner only, enforced by RLS). */
  saveVoiceCast(cast: VoiceCast): Promise<void>;

  /** Rendered multi-voice recordings. */
  getChapterRecording(bookId: string, chapterIndex: number): Promise<ChapterRecording | undefined>;
  listChapterRecordings(bookId: string): Promise<ChapterRecording[]>;
  /** Register a rendered recording (book owner only). Upserts per chapter. */
  saveChapterRecording(input: CreateChapterRecordingInput): Promise<ChapterRecording>;
}

export interface CreateChapterRecordingInput {
  bookId: string;
  chapterIndex: number;
  storagePath: string;
  durationSeconds?: number;
}

export interface CreateCommentInput {
  bookId: string;
  chapterIndex: number;
  body: string;
}
