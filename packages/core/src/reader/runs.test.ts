import { describe, expect, it } from 'vitest';
import type { Annotation } from '../models/types';
import { applyMark, segmentChapterRuns, segmentParagraph } from './runs';

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

describe('applyMark', () => {
  const plain = [{ text: 'Hello world.' }]; // one plain run at paragraph start 0

  it('returns the same runs (identity) when there is no mark', () => {
    expect(applyMark(plain, 0)).toBe(plain);
    expect(applyMark(plain, 0, { start: 5, end: 5 })).toBe(plain); // empty range
  });

  it('returns the same runs when the mark misses this paragraph', () => {
    // Paragraph occupies [100, 112); the mark is elsewhere.
    const runs = [{ text: 'Hello world.' }];
    expect(applyMark(runs, 100, { start: 0, end: 40 })).toBe(runs);
  });

  it('splits a plain run into before / marked / after', () => {
    // Mark "world" (offsets 6..11) within "Hello world." at paragraph start 0.
    const runs = applyMark(plain, 0, { start: 6, end: 11 });
    expect(runs.map((r) => r.text)).toEqual(['Hello ', 'world', '.']);
    expect(runs.map((r) => r.marked)).toEqual([undefined, true, undefined]);
  });

  it('marks from the paragraph start with no leading slice', () => {
    const runs = applyMark(plain, 0, { start: 0, end: 5 });
    expect(runs.map((r) => r.text)).toEqual(['Hello', ' world.']);
    expect(runs[0]?.marked).toBe(true);
    expect(runs[1]?.marked).toBeUndefined();
  });

  it('layers the mark on top of an annotation run, preserving the annotation', () => {
    // "Hello world." with "world" highlighted, then the whole thing marked.
    const annotated = segmentParagraph('Hello world.', 0, [annotation(6, 11)]);
    const marked = applyMark(annotated, 0, { start: 0, end: 12 });
    const worldRun = marked.find((r) => r.text === 'world');
    expect(worldRun?.annotation?.id).toBe('a1');
    expect(worldRun?.marked).toBe(true);
    // Every character is still covered and the concatenation is exact.
    expect(marked.map((r) => r.text).join('')).toBe('Hello world.');
    expect(marked.every((r) => r.marked)).toBe(true);
  });

  it('clamps a mark that spills past the paragraph to the overlapping slice', () => {
    // Paragraph at offset 10; mark 5..15 → covers local [0,5) = "middl".
    const runs = applyMark([{ text: 'middle chunk' }], 10, { start: 5, end: 15 });
    expect(runs.map((r) => r.text)).toEqual(['middl', 'e chunk']);
    expect(runs[0]?.marked).toBe(true);
    expect(runs[1]?.marked).toBeUndefined();
  });
});
