import { describe, expect, it } from 'vitest';
import {
  modelOffsetForRendered,
  pageForRenderedOffset,
  renderedOffsetAtPage,
  renderedOffsetForModel,
  renderedParagraphStarts,
  type PageMetrics,
} from './pagedOffsets';

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

describe('renderedOffsetForModel', () => {
  it('round-trips with modelOffsetForRendered', () => {
    const rendered = renderedParagraphStarts(MODEL_STARTS);
    for (const model of [0, 6, 12, 13, 19, 23]) {
      const there = renderedOffsetForModel(MODEL_STARTS, model);
      expect(modelOffsetForRendered(rendered, there)).toBe(model);
    }
  });

  it('adds one character per paragraph break before the offset', () => {
    expect(renderedOffsetForModel(MODEL_STARTS, 6)).toBe(6);
    expect(renderedOffsetForModel(MODEL_STARTS, 13)).toBe(14);
  });
});

// A chapter measuring 1000px in 250px pages: four pages of 500 rendered chars.
const METRICS: PageMetrics = {
  renderedTotal: 500,
  contentHeight: 1000,
  pageStep: 250,
  totalPages: 4,
};

describe('pageForRenderedOffset', () => {
  it('places an offset on the page holding its share of the text', () => {
    expect(pageForRenderedOffset(0, METRICS)).toBe(0);
    expect(pageForRenderedOffset(130, METRICS)).toBe(1);
    expect(pageForRenderedOffset(260, METRICS)).toBe(2);
  });

  it('clamps past the end to the last page (used to flow in backwards)', () => {
    expect(pageForRenderedOffset(Number.MAX_SAFE_INTEGER, METRICS)).toBe(3);
  });

  it('is page zero before layout has measured anything', () => {
    expect(pageForRenderedOffset(400, { ...METRICS, contentHeight: 0, pageStep: 0 })).toBe(0);
  });
});

describe('renderedOffsetAtPage', () => {
  it('reports what sits at the top of each page', () => {
    expect(renderedOffsetAtPage(0, METRICS)).toBe(0);
    expect(renderedOffsetAtPage(1, METRICS)).toBe(125);
    expect(renderedOffsetAtPage(3, METRICS)).toBe(375);
  });

  it('round-trips back to the same page', () => {
    for (const page of [0, 1, 2, 3]) {
      expect(pageForRenderedOffset(renderedOffsetAtPage(page, METRICS), METRICS)).toBe(page);
    }
  });

  it('never reports past the end of the text', () => {
    expect(renderedOffsetAtPage(99, METRICS)).toBe(500);
  });
});
