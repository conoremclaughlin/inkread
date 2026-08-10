import { describe, expect, it } from 'vitest';
import {
  bookListPrice,
  chapterCoinCost,
  isChapterFree,
  paidChapterCount,
  remainingUnlockCost,
} from './pricing';

describe('chapter pricing', () => {
  const paid = { freeChapterCount: 3, coinsPerChapter: 5 };

  it('treats a book with no per-chapter price as entirely free', () => {
    const free = { freeChapterCount: 0, coinsPerChapter: 0 };
    expect(isChapterFree(free, 0)).toBe(true);
    expect(isChapterFree(free, 99)).toBe(true);
    expect(chapterCoinCost(free, 99)).toBe(0);
    expect(bookListPrice(free, 100)).toBe(0);
  });

  it('frees the head of a serial and prices the tail', () => {
    expect(isChapterFree(paid, 0)).toBe(true);
    expect(isChapterFree(paid, 2)).toBe(true);
    expect(isChapterFree(paid, 3)).toBe(false);
    expect(chapterCoinCost(paid, 2)).toBe(0);
    expect(chapterCoinCost(paid, 3)).toBe(5);
  });

  it('counts and prices the paid chapters', () => {
    expect(paidChapterCount(paid, 10)).toBe(7);
    expect(bookListPrice(paid, 10)).toBe(35);
  });

  it('never counts negative paid chapters when the free head exceeds the book', () => {
    expect(paidChapterCount(paid, 2)).toBe(0);
    expect(bookListPrice(paid, 2)).toBe(0);
  });

  it('charges only for the still-locked paid chapters', () => {
    // 10 chapters, 3 free, 5 coins each → chapters 3..9 are paid (7 × 5 = 35).
    expect(remainingUnlockCost(paid, 10, [])).toBe(35);
    // Already own 3, 4, 5 → 4 paid chapters left (20).
    expect(remainingUnlockCost(paid, 10, [3, 4, 5])).toBe(20);
    // Owning a free chapter doesn't change the bill.
    expect(remainingUnlockCost(paid, 10, [0, 1, 2])).toBe(35);
    // A Set works the same as an array.
    expect(remainingUnlockCost(paid, 10, new Set([3, 4, 5, 6, 7, 8, 9]))).toBe(0);
  });

  it('defaults missing knobs to a free book', () => {
    expect(isChapterFree({}, 0)).toBe(true);
    expect(chapterCoinCost({}, 5)).toBe(0);
    expect(remainingUnlockCost({}, 20, [])).toBe(0);
  });
});
