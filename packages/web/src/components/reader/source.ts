import type { Chapter } from '@inkread/core';

/**
 * A `ChapterSource` is the seam that lets ONE reader view serve two worlds:
 * the owner reading their own library (everything in memory, all unlocked,
 * full write access) and a public reader discovering a serial (chapters loaded
 * lazily through the entitlement gate, paid ones coming back `locked`).
 *
 * "Locked" is a data state — the single view renders it as a paywall. Writes
 * (highlight, note, save-position) are capability-gated; per product decision an
 * anonymous reader is not *hidden* the affordance but *prompted to sign up* on
 * use, which `requireAuth` handles.
 */

/** A chapter as the reader consumes it — a superset of core's ReadChapter. */
export interface LoadedChapter {
  index: number;
  title: string;
  /** Present iff the reader is entitled; absent ⇒ the view renders a paywall. */
  paragraphs?: string[];
  locked: boolean;
  /** Coin cost to unlock, for the paywall CTA (0 when free/owned). */
  coinCost: number;
}

export interface ReaderCapabilities {
  canAnnotate: boolean;
  canPersistPosition: boolean;
  canComment: boolean;
}

/** What a write action wants to do — used to tailor the sign-up prompt. */
export type AuthIntent = 'highlight' | 'note' | 'comment' | 'position';

export interface ChapterSource {
  /** Total chapters — replaces every `chapters.length`. */
  count: number;
  /** Titles in order — the TOC and resume labels; length === count. */
  titles: string[];

  /** Lazy body access (fetch-on-demand + cache). Owner resolves same-tick. */
  getChapter(index: number): Promise<LoadedChapter>;
  /** Synchronous cache hit — lets the owner path render with no loading gap. */
  peek(index: number): LoadedChapter | undefined;
  /** Warm a chapter into cache (e.g. the next one) so a turn is instant. */
  prefetch(index: number): void;

  capabilities: ReaderCapabilities;
  /**
   * Gate a write. Returns true if it may proceed; if false, the gate has
   * already been handled (e.g. a redirect to sign up) and the caller aborts.
   */
  requireAuth(intent: AuthIntent): boolean;

  // --- Paywall accessors (populated by the public source only) ---
  wallet?: { balance: number };
  unlocked?: Set<number>;
  pricing?: { freeChapterCount: number; coinsPerChapter: number; chapterCount: number };
  /** Re-fetch a chapter body + wallet after a purchase unlocks it. */
  onUnlocked?(index: number): Promise<void>;
}

function ownedChapter(chapter: Chapter, index: number): LoadedChapter {
  return { index, title: chapter.title, paragraphs: chapter.paragraphs, locked: false, coinCost: 0 };
}

/**
 * The owner's source: the whole book is already in memory, every chapter is
 * unlocked, and all writes are permitted. `peek` resolves synchronously, so a
 * reader built on this behaves exactly as the pre-refactor reader did.
 */
export function createLibrarySource(chapters: Chapter[]): ChapterSource {
  const loaded = chapters.map(ownedChapter);
  return {
    count: chapters.length,
    titles: chapters.map((c) => c.title),
    getChapter: (index) => Promise.resolve(loaded[index]!),
    peek: (index) => loaded[index],
    prefetch: () => {},
    capabilities: { canAnnotate: true, canPersistPosition: true, canComment: true },
    requireAuth: () => true,
  };
}
