import { describe, expect, it } from 'vitest';
import { paginate, pageOfLine, type LineBox } from './pagination';

/** Uniform lines: `count` lines of `height`, stacked from y=0. */
function stack(count: number, height: number): LineBox[] {
  return Array.from({ length: count }, (_, i) => ({ y: i * height, height }));
}

describe('paginate', () => {
  it('returns no pages for empty input or a non-positive viewport', () => {
    expect(paginate([], 100)).toEqual([]);
    expect(paginate(stack(3, 10), 0)).toEqual([]);
    expect(paginate(stack(3, 10), -5)).toEqual([]);
  });

  it('puts everything on one page when it all fits', () => {
    const pages = paginate(stack(3, 10), 100);
    expect(pages).toEqual([{ firstLine: 0, lastLine: 2, top: 0 }]);
  });

  it('breaks into pages at line boundaries, never splitting a line', () => {
    // 10 lines of height 10 (y = 0..90), viewport 30 → 3 lines/page.
    const pages = paginate(stack(10, 10), 30);
    expect(pages).toEqual([
      { firstLine: 0, lastLine: 2, top: 0 },
      { firstLine: 3, lastLine: 5, top: 30 },
      { firstLine: 6, lastLine: 8, top: 60 },
      { firstLine: 9, lastLine: 9, top: 90 },
    ]);
    // Every page's content height is within the viewport.
    for (const p of pages) {
      const lines = stack(10, 10);
      const height = lines[p.lastLine]!.y + lines[p.lastLine]!.height - p.top;
      expect(height).toBeLessThanOrEqual(30);
    }
  });

  it('gives a line taller than the viewport its own page (always progresses)', () => {
    const lines: LineBox[] = [
      { y: 0, height: 10 },
      { y: 10, height: 50 }, // taller than the 30px viewport
      { y: 60, height: 10 },
    ];
    const pages = paginate(lines, 30);
    expect(pages).toEqual([
      { firstLine: 0, lastLine: 0, top: 0 },
      { firstLine: 1, lastLine: 1, top: 10 },
      { firstLine: 2, lastLine: 2, top: 60 },
    ]);
  });

  it('handles uneven line heights greedily', () => {
    const lines: LineBox[] = [
      { y: 0, height: 20 },
      { y: 20, height: 20 },
      { y: 40, height: 20 }, // this one tips past a 50px viewport
      { y: 60, height: 20 },
    ];
    const pages = paginate(lines, 50);
    expect(pages).toEqual([
      { firstLine: 0, lastLine: 1, top: 0 }, // 0..40 fits in 50
      { firstLine: 2, lastLine: 3, top: 40 }, // 40..80 fits in 50 from top=40
    ]);
  });

  it('covers every line exactly once across pages', () => {
    const lines = stack(37, 13);
    const pages = paginate(lines, 44);
    const covered: number[] = [];
    for (const p of pages) {
      for (let i = p.firstLine; i <= p.lastLine; i++) covered.push(i);
    }
    expect(covered).toEqual(Array.from({ length: 37 }, (_, i) => i));
  });
});

describe('pageOfLine', () => {
  it('finds which page a line is on, or -1 when out of range', () => {
    const pages = paginate(stack(10, 10), 30);
    expect(pageOfLine(pages, 0)).toBe(0);
    expect(pageOfLine(pages, 4)).toBe(1);
    expect(pageOfLine(pages, 9)).toBe(3);
    expect(pageOfLine(pages, 99)).toBe(-1);
  });
});
