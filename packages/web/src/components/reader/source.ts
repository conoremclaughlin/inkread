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

export interface PublicSourceInit {
  bookId: string;
  /** Chapter titles in order — the whole TOC is public even when bodies aren't. */
  titles: string[];
  signedIn: boolean;
  balance: number;
  /** Chapter indexes this reader has already unlocked. */
  unlocked: number[];
  pricing: { freeChapterCount: number; coinsPerChapter: number };
  /** The chapter the page was rendered with, so the first paint needs no fetch. */
  initial?: LoadedChapter;
  /** Where an anonymous reader is sent to sign in (defaults to /login). */
  onAuthRequired?: (intent: AuthIntent) => void;
}

/**
 * The public reader's source: a published series read through the entitlement
 * gate. Bodies arrive one chapter at a time from
 * `/api/books/:id/read/:chapter` — a locked chapter comes back without its
 * text, which the reader renders as a paywall.
 *
 * Capabilities follow the session, not ownership: a signed-in reader may
 * annotate, comment and keep their place in someone else's book (those rows are
 * theirs), while an anonymous visitor gets the affordances but is prompted to
 * sign in when they use one.
 */
export function createPublicSource(init: PublicSourceInit): ChapterSource {
  const cache = new Map<number, LoadedChapter>();
  const inflight = new Map<number, Promise<LoadedChapter>>();
  if (init.initial) cache.set(init.initial.index, init.initial);
  const unlocked = new Set(init.unlocked);
  const wallet = { balance: init.balance };

  const titleAt = (index: number) => init.titles[index] ?? `Chapter ${index + 1}`;

  async function fetchChapter(index: number): Promise<LoadedChapter> {
    const response = await fetch(`/api/books/${init.bookId}/read/${index}`);
    if (!response.ok) {
      // A chapter we can't load is not a chapter we can read: show it locked
      // rather than blanking the reader.
      return { index, title: titleAt(index), locked: true, coinCost: init.pricing.coinsPerChapter };
    }
    const body = (await response.json()) as {
      chapter: { title: string; paragraphs?: string[]; locked: boolean; coinCost: number };
    };
    return {
      index,
      title: body.chapter.title || titleAt(index),
      paragraphs: body.chapter.paragraphs,
      locked: body.chapter.locked,
      coinCost: body.chapter.coinCost,
    };
  }

  function load(index: number): Promise<LoadedChapter> {
    const cached = cache.get(index);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(index);
    if (pending) return pending;
    const request = fetchChapter(index)
      .then((chapter) => {
        cache.set(index, chapter);
        if (!chapter.locked) unlocked.add(index);
        return chapter;
      })
      .finally(() => inflight.delete(index));
    inflight.set(index, request);
    return request;
  }

  return {
    count: init.titles.length,
    titles: init.titles,
    getChapter: load,
    peek: (index) => cache.get(index),
    prefetch: (index) => {
      if (index >= 0 && index < init.titles.length) void load(index).catch(() => undefined);
    },
    capabilities: {
      canAnnotate: init.signedIn,
      canPersistPosition: init.signedIn,
      canComment: init.signedIn,
    },
    requireAuth: (intent) => {
      if (init.signedIn) return true;
      if (init.onAuthRequired) init.onAuthRequired(intent);
      else if (typeof window !== 'undefined') {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
      return false;
    },
    wallet,
    unlocked,
    pricing: { ...init.pricing, chapterCount: init.titles.length },
    onUnlocked: async (index) => {
      // The purchase already happened; drop the stale locked copy so the body
      // is refetched, and refresh the balance the paywall quotes.
      cache.delete(index);
      unlocked.add(index);
      await load(index);
      try {
        const response = await fetch('/api/wallet');
        if (response.ok) {
          const body = (await response.json()) as { balance?: number };
          if (typeof body.balance === 'number') wallet.balance = body.balance;
        }
      } catch {
        // A stale balance is cosmetic; the unlock itself is recorded server-side.
      }
    },
  };
}
