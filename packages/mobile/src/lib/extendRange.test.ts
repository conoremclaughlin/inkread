import { describe, expect, it } from 'vitest';
import { foldExtendRange } from './extendRange';

// Offsets are into the chapter's plain text (paragraphs joined by newlines).
const TEXT = 'The keeper climbed the stair.\nThe lamp remembered everything.';
const anchor = { start: 4, length: 6 }; // "keeper"

describe('foldExtendRange', () => {
  it('extends forward to a selection later in the chapter', () => {
    const range = foldExtendRange(anchor, { start: 34, end: 38 }, TEXT);
    expect(range.start).toBe(4);
    expect(range.end).toBe(38);
    expect(range.text).toBe(TEXT.slice(4, 38));
  });

  it('fills in everything between the endpoints, not just the two selections', () => {
    const range = foldExtendRange(anchor, { start: 34, end: 38 }, TEXT);
    // The words nobody selected are still part of the passage.
    expect(range.text).toContain('climbed the stair');
    // …including the paragraph break.
    expect(range.text).toContain('\n');
  });

  it('extends backwards when the far end is before the anchor', () => {
    const range = foldExtendRange({ start: 30, length: 3 }, { start: 4, end: 10 }, TEXT);
    expect(range).toMatchObject({ start: 4, end: 33 });
  });

  it('never shrinks below the anchor when the second selection is inside it', () => {
    const range = foldExtendRange(anchor, { start: 5, end: 7 }, TEXT);
    expect(range).toMatchObject({ start: 4, end: 10, text: 'keeper' });
  });

  it('keeps the anchor when the same words are selected again', () => {
    expect(foldExtendRange(anchor, { start: 4, end: 10 }, TEXT)).toMatchObject({
      start: 4,
      end: 10,
    });
  });

  it('handles an anchor at the very start of the chapter', () => {
    const range = foldExtendRange({ start: 0, length: 3 }, { start: 11, end: 18 }, TEXT);
    expect(range).toMatchObject({ start: 0, end: 18 });
    expect(range.text).toBe(TEXT.slice(0, 18));
  });
});
