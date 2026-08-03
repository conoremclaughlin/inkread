import { describe, expect, it } from 'vitest';
import { isActivelyPublished, rankByScore } from './publishing';

describe('isActivelyPublished', () => {
  it('is true only for a public, ongoing work', () => {
    expect(isActivelyPublished({ visibility: 'public', status: 'ongoing' })).toBe(true);
  });

  it('is false when private, completed, or unset', () => {
    expect(isActivelyPublished({ visibility: 'private', status: 'ongoing' })).toBe(false);
    expect(isActivelyPublished({ visibility: 'public', status: 'completed' })).toBe(false);
    expect(isActivelyPublished({})).toBe(false);
  });
});

describe('rankByScore', () => {
  it('orders by score descending', () => {
    const ranked = rankByScore([
      { id: 'a', score: 2, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'b', score: 9, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'c', score: 5, createdAt: '2026-01-01T00:00:00Z' },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks score ties with the newer comment first', () => {
    const ranked = rankByScore([
      { id: 'old', score: 3, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'new', score: 3, createdAt: '2026-06-01T00:00:00Z' },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('treats a missing score as zero and does not mutate the input', () => {
    const input = [
      { id: 'none', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'neg', score: -1, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'pos', score: 1, createdAt: '2026-01-01T00:00:00Z' },
    ];
    const ranked = rankByScore(input);
    expect(ranked.map((r) => r.id)).toEqual(['pos', 'none', 'neg']);
    expect(input[0]!.id).toBe('none'); // original order preserved
  });
});
