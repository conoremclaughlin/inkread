/**
 * Core domain types shared between the conversion pipeline, the reader,
 * and the export/share features. Everything here is plain data — safe to
 * persist as JSON and to pass across the WebView bridge.
 */

/** A single positioned text run extracted from a PDF page (pdf.js item, normalized). */
export interface PdfTextItem {
  text: string;
  /** Left edge, PDF user-space units. */
  x: number;
  /** Baseline y, PDF user-space units. Origin is bottom-left: larger y = higher on page. */
  y: number;
  fontSize: number;
  /** Advance width of the run, when the extractor provides it. */
  width?: number;
  fontName?: string;
}

export interface PdfPage {
  /** 1-based page number in the source PDF. */
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}

/** A reflowable chapter produced by segmentation — the unit the reader renders. */
export interface Chapter {
  title: string;
  paragraphs: string[];
  /** Marks headings promoted from the PDF but kept inside a chapter body. */
  kind?: 'chapter' | 'frontmatter';
  /** Source PDF pages this chapter spans, for provenance / debugging. */
  sourcePages?: { from: number; to: number };
}

/** Is a book private to its owner, or published for anyone to discover. */
export type BookVisibility = 'private' | 'public';

/** Whether a published work is still gaining chapters, or finished. */
export type PublicationStatus = 'ongoing' | 'completed';

export interface BookMeta {
  id: string;
  title: string;
  author?: string;
  language?: string;
  /** Where this book came from. */
  source: 'pdf' | 'epub' | 'text';
  /** Publication reach — defaults to 'private' for imported personal books. */
  visibility?: BookVisibility;
  /** Serialization state of a published work — defaults to 'ongoing'. */
  status?: PublicationStatus;
  /** Chapters readable without paying — the free head of a serial (default 0). */
  freeChapterCount?: number;
  /** Coins to unlock each chapter past the free head; 0 means the whole book is free. */
  coinsPerChapter?: number;
  createdAt: string;
}

/**
 * A reader's coin wallet. Coins are an in-app currency (demo-funded to start);
 * spending them records a permanent {@link ChapterUnlock}. The balance is the
 * denormalized running total the ledger below reconstructs.
 */
export interface Wallet {
  balance: number;
}

/** Why coins moved. Membership grants will extend this set, not replace it. */
export type CoinLedgerReason =
  | 'signup_grant'
  | 'topup'
  | 'unlock_spend'
  | 'author_earning'
  | 'refund'
  | 'adjustment';

/** One append-only movement of coins, with the balance it left behind. */
export interface CoinLedgerEntry {
  id: string;
  delta: number;
  reason: CoinLedgerReason;
  bookId?: string;
  chapterIndex?: number;
  balanceAfter: number;
  createdAt: string;
}

/**
 * A permanent per-user entitlement to one chapter. It grants the chapter in any
 * rendition — reflowable text now, and the same gate frees its TTS / voice-cast
 * audio later — so a purchase buys the whole multimedia experience, not a format.
 */
export interface ChapterUnlock {
  bookId: string;
  chapterIndex: number;
  coinsSpent: number;
  createdAt: string;
}

/** Public author/reader identity; the wallet balance lives here too. */
export interface Profile {
  userId: string;
  username?: string;
  displayName?: string;
  coinBalance: number;
  isAuthor: boolean;
}

/** Result of a purchase (unlock a chapter, or batch-unlock a book). */
export interface PurchaseResult {
  /** Chapter indices accessible after the call (newly unlocked or already owned). */
  unlocked: number[];
  coinsSpent: number;
  balance: number;
}

/**
 * A chapter delivered through the entitlement gate. `paragraphs` is present only
 * when the reader is entitled (the free head, the owner, or a recorded unlock);
 * otherwise the chapter is `locked` and the client shows a paywall at `coinCost`.
 */
export interface ReadChapter {
  chapterIndex: number;
  title: string;
  paragraphs?: string[];
  locked: boolean;
  coinCost: number;
}

export type AnnotationKind = 'highlight' | 'note';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

/**
 * Locates a text range inside a chapter by character offsets into the
 * chapter's plain text (paragraphs joined with '\n'). Simple, stable for
 * books we generated ourselves, and cheap to resolve in the reader.
 */
export interface TextLocator {
  chapterIndex: number;
  start: number;
  end: number;
}

export interface Annotation {
  id: string;
  bookId: string;
  kind: AnnotationKind;
  locator: TextLocator;
  /** The passage text as highlighted (denormalized so exports never need the book). */
  passage: string;
  /** The user's note, when kind === 'note' (a note always anchors to a passage). */
  note?: string;
  color: HighlightColor;
  chapterTitle?: string;
  createdAt: string;
}

/**
 * A reader's comment on a chapter — the social layer. Anchored per-chapter
 * (not per-highlight) to start; visible to everyone with access to the book.
 */
export interface Comment {
  id: string;
  bookId: string;
  chapterIndex: number;
  authorId: string;
  /** Display name, denormalized so the list never needs a user lookup. */
  authorName?: string;
  body: string;
  createdAt: string;
  /** Net vote score (upvotes − downvotes); present on publicly-ranked reads. */
  score?: number;
  upvotes?: number;
  downvotes?: number;
}

/**
 * A stored multi-voice audio recording of a chapter — rendered from a VoiceCast
 * and saved so anyone with access to the book can listen later.
 */
export interface ChapterRecording {
  id: string;
  bookId: string;
  chapterIndex: number;
  /** Object path in the recordings storage bucket. */
  storagePath: string;
  durationSeconds?: number;
  createdAt: string;
}

/** Reading position, persisted per book. */
export interface ReadingPosition {
  bookId: string;
  chapterIndex: number;
  /** Character offset into the chapter plain text of the first visible line. */
  offset: number;
  updatedAt: string;
  /**
   * High-water mark — the furthest point ever read. Only moves forward;
   * drives progress display and "resume where I got to" while the current
   * position freely moves backwards for re-reading.
   */
  furthest?: { chapterIndex: number; offset: number };
}
