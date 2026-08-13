// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { offsetWithin, paragraphOf, rangeOffsets, resolveOffset } from './dom';

/**
 * Fixture mirrors the offset model: chapter text = paragraphs.join('\n').
 *   p0: "Hello world."      → data-po 0   (length 12)
 *   p1: "Second para here." → data-po 13  (length 17)
 *   p2: "A marked word."    → data-po 31, with "marked" wrapped in a span
 *       (a rendered highlight) to prove offsets ignore element boundaries.
 */
function fixture(): { root: HTMLElement; p: HTMLParagraphElement[] } {
  const root = document.createElement('div');
  root.innerHTML =
    '<p data-po="0">Hello world.</p>' +
    '<p data-po="13">Second para here.</p>' +
    '<p data-po="31">A <span class="hl">marked</span> word.</p>';
  document.body.appendChild(root);
  return { root, p: Array.from(root.querySelectorAll('p')) };
}

describe('paragraphOf', () => {
  it('finds the enclosing data-po paragraph from a text node', () => {
    const { p } = fixture();
    expect(paragraphOf(p[1]!.firstChild!)).toBe(p[1]);
  });

  it('walks up through nested elements (highlight spans)', () => {
    const { root, p } = fixture();
    const spanText = root.querySelector('span')!.firstChild!;
    expect(paragraphOf(spanText)).toBe(p[2]);
  });

  it('returns null outside any data-po paragraph', () => {
    const { root } = fixture();
    expect(paragraphOf(root)).toBeNull();
  });
});

describe('offsetWithin', () => {
  it('maps a position in a paragraph to its chapter offset', () => {
    const { p } = fixture();
    expect(offsetWithin(p[0]!, p[0]!.firstChild!, 6)).toBe(6);
    expect(offsetWithin(p[1]!, p[1]!.firstChild!, 3)).toBe(16);
  });

  it('counts text before a nested span', () => {
    const { root, p } = fixture();
    const spanText = root.querySelector('span')!.firstChild!;
    // 31 (paragraph start) + "A " (2) + 2 into "marked" = 35
    expect(offsetWithin(p[2]!, spanText, 2)).toBe(35);
  });
});

describe('rangeOffsets', () => {
  it('maps a same-paragraph selection', () => {
    const { p } = fixture();
    const range = document.createRange();
    range.setStart(p[0]!.firstChild!, 6);
    range.setEnd(p[0]!.firstChild!, 11);
    expect(rangeOffsets(range)).toEqual({ start: 6, end: 11, text: 'world' });
  });

  it('maps a cross-paragraph selection (offsets count the joining newline)', () => {
    const { p } = fixture();
    const range = document.createRange();
    range.setStart(p[0]!.firstChild!, 6);
    range.setEnd(p[1]!.firstChild!, 6);
    const result = rangeOffsets(range)!;
    // "world." ends p0 at 12; '\n' is 12→13; "Second" ends at 19.
    expect(result.start).toBe(6);
    expect(result.end).toBe(19);
    // Range.toString() concatenates without the '\n'; offsets still count it.
    expect(result.text).toBe('world.Second');
  });

  it('returns null when an endpoint is outside a data-po paragraph', () => {
    const stray = document.createElement('p'); // no data-po
    stray.textContent = 'chrome text';
    document.body.appendChild(stray);
    const range = document.createRange();
    range.setStart(stray.firstChild!, 0);
    range.setEnd(stray.firstChild!, 3);
    expect(rangeOffsets(range)).toBeNull();
  });
});

describe('resolveOffset', () => {
  it('is the inverse of offsetWithin', () => {
    const { root, p } = fixture();
    expect(resolveOffset(root, 0)).toEqual({ node: p[0]!.firstChild!, offset: 0 });
    expect(resolveOffset(root, 16)).toEqual({ node: p[1]!.firstChild!, offset: 3 });
  });

  it('lands on a paragraph boundary at its first character', () => {
    const { root, p } = fixture();
    expect(resolveOffset(root, 13)).toEqual({ node: p[1]!.firstChild!, offset: 0 });
  });

  it('descends into nested spans', () => {
    const { root } = fixture();
    const spanText = root.querySelector('span')!.firstChild!;
    expect(resolveOffset(root, 35)).toEqual({ node: spanText, offset: 2 });
  });

  it('falls back to the last paragraph element past the end of the text', () => {
    const { root, p } = fixture();
    expect(resolveOffset(root, 9999)).toEqual({ node: p[2], offset: 0, element: true });
  });

  it('returns null before the first paragraph', () => {
    const { root } = fixture();
    expect(resolveOffset(root, -1)).toBeNull();
  });
});
