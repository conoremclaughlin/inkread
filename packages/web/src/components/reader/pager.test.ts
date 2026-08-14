import { describe, expect, it } from 'vitest';
import {
  clampX,
  COLUMN_GAP,
  dragAxis,
  dragTurn,
  pageAt,
  pageWidth,
  rubberBand,
  settle,
  tapZone,
} from './pager';

// A 512px-wide column in an 600px viewport: one page step is 600px.
const STEP = pageWidth(512);
const MAX = STEP * 3; // four pages of content

describe('pageWidth', () => {
  it('is the column plus its gutter', () => {
    expect(pageWidth(512)).toBe(512 + COLUMN_GAP);
    expect(pageWidth(300, 40)).toBe(340);
  });

  it('never collapses to zero (unmeasured content)', () => {
    expect(pageWidth(-100, 0)).toBe(1);
  });
});

describe('pageAt', () => {
  it('snaps to the nearest boundary', () => {
    expect(pageAt(0, STEP)).toBe(0);
    expect(pageAt(STEP * 0.4, STEP)).toBe(0);
    expect(pageAt(STEP * 0.6, STEP)).toBe(STEP);
    expect(pageAt(STEP * 2.5, STEP)).toBe(STEP * 3);
  });
});

describe('settle', () => {
  it('advances and rewinds one page', () => {
    expect(settle(0, 1, STEP, MAX)).toEqual({ x: STEP });
    expect(settle(STEP * 2, -1, STEP, MAX)).toEqual({ x: STEP });
  });

  it('springs back to the same page for a cancelled drag', () => {
    expect(settle(STEP * 1.1, 0, STEP, MAX)).toEqual({ x: STEP });
  });

  it('reports the previous-chapter edge at the start of the chapter', () => {
    expect(settle(0, -1, STEP, MAX)).toEqual({ x: 0, edge: 'prev' });
  });

  it('reports the next-chapter edge past the last page', () => {
    expect(settle(MAX, 1, STEP, MAX)).toEqual({ x: MAX, edge: 'next' });
  });

  it('treats a sub-pixel overshoot of the last page as a real page', () => {
    // Fractional column widths can put the final page a hair past maxX.
    expect(settle(MAX - STEP, 1, STEP, MAX - 0.5)).toEqual({ x: MAX - 0.5 });
  });
});

describe('rubberBand', () => {
  it('is the identity inside the content', () => {
    expect(rubberBand(STEP, MAX)).toBe(STEP);
  });

  it('resists past either end', () => {
    expect(rubberBand(-100, MAX)).toBe(-40);
    expect(rubberBand(MAX + 100, MAX)).toBe(MAX + 40);
  });
});

describe('dragTurn', () => {
  it('ignores a short, slow drag', () => {
    expect(dragTurn(-20, 800, STEP)).toBe(0);
  });

  it('turns forward when dragging left past the threshold', () => {
    expect(dragTurn(-STEP * 0.3, 800, STEP)).toBe(1);
  });

  it('turns back when dragging right past the threshold', () => {
    expect(dragTurn(STEP * 0.3, 800, STEP)).toBe(-1);
  });

  it('accepts a short fast flick', () => {
    expect(dragTurn(-45, 120, STEP)).toBe(1);
    expect(dragTurn(45, 120, STEP)).toBe(-1);
  });
});

describe('dragAxis', () => {
  it('withholds a verdict until the gesture moves', () => {
    expect(dragAxis(3, 4)).toBeNull();
  });

  it('needs a clear horizontal lead to page', () => {
    expect(dragAxis(40, 10)).toBe('horizontal');
    expect(dragAxis(20, 18)).toBe('vertical');
    expect(dragAxis(10, 40)).toBe('vertical');
  });
});

describe('tapZone', () => {
  it('maps taps to the edge zones', () => {
    expect(tapZone(10, 1000)).toBe('prev');
    expect(tapZone(500, 1000)).toBe('center');
    expect(tapZone(990, 1000)).toBe('next');
  });
});

describe('clampX', () => {
  it('keeps the view inside the content', () => {
    expect(clampX(-50, MAX)).toBe(0);
    expect(clampX(MAX + 50, MAX)).toBe(MAX);
  });
});
