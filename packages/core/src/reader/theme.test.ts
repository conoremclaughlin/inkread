import { describe, expect, it } from 'vitest';
import type { Annotation, Chapter } from '../models/types';
import {
  buildReaderHtml,
  HIGHLIGHT_COLORS,
  highlightRgb,
  isDarkTheme,
  type ReaderTheme,
} from './html';

const CHAPTER: Chapter = {
  title: 'Chapter <One>',
  paragraphs: ['First paragraph here.', 'Second paragraph & more text.'],
};

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

describe('buildReaderHtml', () => {
  it('escapes chapter title and paragraph text', () => {
    const html = buildReaderHtml(CHAPTER, [], { theme: 'light', fontSize: 18 });
    expect(html).toContain('Chapter &lt;One&gt;');
    expect(html).toContain('Second paragraph &amp; more text.');
  });

  it('assigns data-po offsets matching paragraphs.join("\\n")', () => {
    const html = buildReaderHtml(CHAPTER, [], { theme: 'light', fontSize: 18 });
    expect(html).toContain('<p data-po="0">');
    // Second paragraph starts after first (21 chars) + newline.
    expect(html).toContain(`<p data-po="${'First paragraph here.'.length + 1}">`);
  });

  it('renders a highlight span across the annotated range', () => {
    // Highlight "paragraph" in the first paragraph (offsets 6..15).
    const html = buildReaderHtml(CHAPTER, [annotation(6, 15)], {
      theme: 'sepia',
      fontSize: 18,
    });
    expect(html).toContain('data-hl="a1"');
    expect(html).toMatch(/<span class="hl"[^>]*>paragraph<\/span>/);
  });

  it('splits highlights spanning a paragraph boundary', () => {
    const first = 'First paragraph here.';
    const html = buildReaderHtml(CHAPTER, [annotation(first.length - 5, first.length + 7)], {
      theme: 'dark',
      fontSize: 18,
    });
    // One span at the end of paragraph 1, one at the start of paragraph 2.
    expect(html.match(/data-hl="a1"/g)).toHaveLength(2);
  });

  it('marks noted highlights with the hl-note class', () => {
    const html = buildReaderHtml(CHAPTER, [annotation(0, 5, { note: 'thought', kind: 'note' })], {
      theme: 'light',
      fontSize: 18,
    });
    expect(html).toContain('class="hl hl-note"');
  });

  it('supports both mobile and iframe bridges', () => {
    const html = buildReaderHtml(CHAPTER, [], { theme: 'light', fontSize: 18 });
    expect(html).toContain('window.ReactNativeWebView');
    expect(html).toContain("window.parent.postMessage({ source: 'inkread-reader'");
  });

  it('includes selection bounds so the host can place the action bar below it', () => {
    const html = buildReaderHtml(CHAPTER, [], { theme: 'light', fontSize: 18 });
    expect(html).toContain('range.getBoundingClientRect()');
    expect(html).toContain('bottom: rect.bottom');
  });

  it('exposes the cross-page extend bridge the hosts drive', () => {
    const html = buildReaderHtml(CHAPTER, [], { theme: 'light', fontSize: 18 });
    // mobile + web call these to run the anchor → flip pages → tap-end flow.
    expect(html).toContain('beginExtend: function');
    expect(html).toContain('endExtend: function');
    expect(html).toContain("post({ type: 'extendPoint'");
    // Page turns are driven by the host (turnPage), not by overloaded edge taps.
    expect(html).toContain('turnPage: function');
  });

  it('does not overload edge taps to turn pages during extend', () => {
    // Regression: while extending, a tap near the margin used to flip the page
    // instead of marking the highlight end, so extending across pages felt
    // broken. Every tap now sets the end point; the host owns page turns.
    const html = buildReaderHtml(CHAPTER, [], { theme: 'light', fontSize: 18 });
    // Slice just the `if (extending) { … return; }` body (up to its own return),
    // so the assertion isn't fooled by the separate non-extend edge-tap block.
    const start = html.indexOf('if (extending) {');
    const extendBlock = html.slice(start, html.indexOf('return;', start));
    expect(extendBlock).toContain("Every tap sets the highlight's end point");
    expect(extendBlock).not.toContain('turnPage(-1)');
    expect(extendBlock).not.toContain('turnPage(1)');
  });

  it('themes the page background per setting', () => {
    const dark = buildReaderHtml(CHAPTER, [], { theme: 'dark', fontSize: 18 });
    expect(dark).toContain('background: #121212');
    const sepia = buildReaderHtml(CHAPTER, [], { theme: 'sepia', fontSize: 20 });
    expect(sepia).toContain('background: #f5ecd9');
    expect(sepia).toContain('font-size: 20px');
  });
});

describe('highlightRgb', () => {
  it('uses the raw palette on light themes', () => {
    expect(highlightRgb('yellow', 'paper')).toBe(HIGHLIGHT_COLORS.yellow);
    expect(highlightRgb('green', 'sepia')).toBe(HIGHLIGHT_COLORS.green);
  });

  it('falls back to yellow for an unknown colour', () => {
    expect(highlightRgb('chartreuse', 'paper')).toBe(HIGHLIGHT_COLORS.yellow);
  });

  it('desaturates and darkens on dark themes so text stays readable on top', () => {
    const [r, g, b] = highlightRgb('yellow', 'night')
      .split(',')
      .map((n) => parseInt(n.trim(), 10)) as [number, number, number];
    const [rawR, rawG, rawB] = HIGHLIGHT_COLORS.yellow!
      .split(',')
      .map((n) => parseInt(n.trim(), 10)) as [number, number, number];
    // Darker overall than the light-theme fill…
    expect(r + g + b).toBeLessThan(rawR + rawG + rawB);
    // …and less saturated (the spread between channels narrows).
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(
      Math.max(rawR, rawG, rawB) - Math.min(rawR, rawG, rawB),
    );
    // Still recognisably yellow: red/green lead blue.
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });
});

describe('isDarkTheme', () => {
  it('classifies the dark palettes', () => {
    const dark: ReaderTheme[] = ['night', 'midnight', 'dark'];
    const light: ReaderTheme[] = ['paper', 'sepia', 'calm', 'quiet', 'light'];
    expect(dark.every(isDarkTheme)).toBe(true);
    expect(light.some(isDarkTheme)).toBe(false);
  });
});
