/**
 * Chapter pricing — one pure definition of "what costs coins", shared by the
 * reader paywall, the author's pricing UI, and any purchase preview. Book-level
 * policy to start: a free head of N chapters, then a flat per-chapter price.
 * Kept pure (no chapter bodies, no I/O) so server and client agree to the coin.
 *
 * The authoritative charge happens in the `unlock_chapter` / `unlock_book`
 * Postgres RPCs; these helpers are for display and previews.
 */

/** The pricing knobs on a book — a subset of BookMeta. */
export interface BookPricing {
  /** Chapters readable for free at the start of the serial (default 0). */
  freeChapterCount?: number;
  /** Coins per paid chapter; 0 (the default) means the whole book is free. */
  coinsPerChapter?: number;
}

function freeHead(book: BookPricing): number {
  return Math.max(0, Math.floor(book.freeChapterCount ?? 0));
}

function perChapter(book: BookPricing): number {
  return Math.max(0, Math.floor(book.coinsPerChapter ?? 0));
}

/**
 * A chapter is free when the book carries no per-chapter price, or the chapter
 * sits within the free head.
 */
export function isChapterFree(book: BookPricing, chapterIndex: number): boolean {
  return perChapter(book) === 0 || chapterIndex < freeHead(book);
}

/** Coins to unlock a single chapter — 0 when it's free. */
export function chapterCoinCost(book: BookPricing, chapterIndex: number): number {
  return isChapterFree(book, chapterIndex) ? 0 : perChapter(book);
}

/** How many chapters carry a price, given the book's total chapter count. */
export function paidChapterCount(book: BookPricing, chapterCount: number): number {
  if (perChapter(book) === 0) return 0;
  return Math.max(0, chapterCount - freeHead(book));
}

/** Sticker price to own the whole book — every paid chapter at the flat rate. */
export function bookListPrice(book: BookPricing, chapterCount: number): number {
  return perChapter(book) * paidChapterCount(book, chapterCount);
}

/**
 * Coins still owed to unlock everything, given the chapters already unlocked —
 * what a "buy the rest of the book" button charges.
 */
export function remainingUnlockCost(
  book: BookPricing,
  chapterCount: number,
  unlocked: Iterable<number>,
): number {
  const cost = perChapter(book);
  if (cost === 0) return 0;
  const have = unlocked instanceof Set ? unlocked : new Set(unlocked);
  let total = 0;
  for (let i = freeHead(book); i < chapterCount; i += 1) {
    if (!have.has(i)) total += cost;
  }
  return total;
}
