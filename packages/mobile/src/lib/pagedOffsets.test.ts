import { describe, expect, it } from 'vitest';
import { modelOffsetForRendered, renderedParagraphStarts } from './pagedOffsets';

// Two paragraphs: "Hello world." (12) and "Second one." (11).
// Model text  (join '\n'):  "Hello world.\nSecond one."   → p2 starts at 13.
// Rendered   (join '\n\n'): "Hello world.\n\nSecond one." → p2 starts at 14.
const MODEL_STARTS = [0, 13];

describe('renderedParagraphStarts', () => {
  it('shifts each paragraph start by its index (one extra \\n per prior break)', () => {
    expect(renderedParagraphStarts(MODEL_STARTS)).toEqual([0, 14]);
  });
});

describe('modelOffsetForRendered', () => {
  const rendered = renderedParagraphStarts(MODEL_STARTS);

  it('is identity within the first paragraph', () => {
    expect(modelOffsetForRendered(rendered, 6)).toBe(6); // "world" start
  });

  it('subtracts one for offsets in the second paragraph', () => {
    // "Second" starts at rendered 14 → model 13.
    expect(modelOffsetForRendered(rendered, 14)).toBe(13);
    expect(modelOffsetForRendered(rendered, 20)).toBe(19);
  });

  it('maps a rendered selection back to the exact model slice', () => {
    const model = 'Hello world.\nSecond one.';
    // Select "one" in the rendered text: rendered [21, 24) → model [20, 23).
    const from = modelOffsetForRendered(rendered, 21);
    const to = modelOffsetForRendered(rendered, 24);
    expect(model.slice(from, to)).toBe('one');
  });

  it('handles a single paragraph (no shift)', () => {
    const one = renderedParagraphStarts([0]);
    expect(modelOffsetForRendered(one, 5)).toBe(5);
  });
});
