import { describe, expect, it } from 'vitest';
import type { Annotation, Chapter } from '../models/types';
import { buildReaderHtml } from './html';

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

  it('themes the page background per setting', () => {
    const dark = buildReaderHtml(CHAPTER, [], { theme: 'dark', fontSize: 18 });
    expect(dark).toContain('background: #121212');
    const sepia = buildReaderHtml(CHAPTER, [], { theme: 'sepia', fontSize: 20 });
    expect(sepia).toContain('background: #f5ecd9');
    expect(sepia).toContain('font-size: 20px');
  });
});
