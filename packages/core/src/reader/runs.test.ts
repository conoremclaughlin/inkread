import { describe, expect, it } from 'vitest';
import type { Annotation } from '../models/types';
import { segmentChapterRuns, segmentParagraph } from './runs';

function annotation(start: number, end: number, overrides?: Partial<Annotation>): Annotation {
  return {
    id: 'a1',
    bookId: 'b1',
    kind: 'highlight',
    locator: { chapterIndex: 0, start, end },
    passage: 'x',
    color: 'green',
    createdAt: '2026-07-04T00:00:00Z',
    ...overrides,
  };
}

describe('segmentParagraph', () => {
  it('returns the whole paragraph as one plain run when nothing overlaps', () => {
    const runs = segmentParagraph('Hello world.', 0, []);
    expect(runs).toEqual([{ text: 'Hello world.' }]);
  });

  it('splits a mid-paragraph highlight into plain / highlighted / plain', () => {
    // Highlight "world" (offsets 6..11) within "Hello world."
    const runs = segmentParagraph('Hello world.', 0, [annotation(6, 11)]);
    expect(runs.map((r) => r.text)).toEqual(['Hello ', 'world', '.']);
    expect(runs[1]?.annotation?.id).toBe('a1');
    expect(runs[0]?.annotation).toBeUndefined();
    expect(runs[2]?.annotation).toBeUndefined();
  });

  it('clips a highlight that starts before / ends after this paragraph', () => {
    // Paragraph sits at offset 10; annotation covers 5..30 (spills both ends).
    const runs = segmentParagraph('middle chunk', 10, [annotation(5, 30)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ text: 'middle chunk', annotation: expect.objectContaining({ id: 'a1' }) });
  });
});

describe('segmentChapterRuns', () => {
  const paragraphs = ['First paragraph here.', 'Second paragraph & more.'];

  it('assigns paragraph start offsets matching paragraphs.join("\\n")', () => {
    const result = segmentChapterRuns(paragraphs, []);
    expect(result[0]?.start).toBe(0);
    expect(result[1]?.start).toBe('First paragraph here.'.length + 1); // +1 for '\n'
  });

  it('places a highlight spanning a paragraph boundary in both paragraphs', () => {
    const firstLen = 'First paragraph here.'.length;
    // Cover the last 5 chars of p1 and first 7 of p2 (across the '\n').
    const result = segmentChapterRuns(paragraphs, [annotation(firstLen - 5, firstLen + 1 + 6)]);
    const annotatedRuns = result.flatMap((p) => p.runs).filter((r) => r.annotation);
    expect(annotatedRuns).toHaveLength(2); // one tail run in p1, one head run in p2
    expect(annotatedRuns.every((r) => r.annotation?.id === 'a1')).toBe(true);
  });

  it('reconstructs each paragraph exactly by concatenating its runs', () => {
    const result = segmentChapterRuns(paragraphs, [annotation(3, 9), annotation(25, 31)]);
    result.forEach((p, i) => {
      expect(p.runs.map((r) => r.text).join('')).toBe(paragraphs[i]);
    });
  });
});
