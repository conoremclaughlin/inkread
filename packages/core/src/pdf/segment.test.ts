import { describe, expect, it } from 'vitest';
import type { PdfPage, PdfTextItem } from '../models/types';
import { reconstructLines, segmentPages } from './segment';

/**
 * Synthetic page builder. Lays lines top-to-bottom on a 600×800 page,
 * remembering that PDF y grows upward (top of page = high y).
 */
interface FakeLine {
  text: string;
  fontSize?: number;
  x?: number;
  /** Extra vertical gap above this line, in multiples of line height. */
  gapBefore?: number;
}

const PAGE_W = 600;
const PAGE_H = 800;
// Content starts below the 8% header band (800 * 0.08 = 64).
const TOP_MARGIN = 90;
const BODY = 12;

function makePage(pageNumber: number, lines: FakeLine[], furniture?: FakeLine[]): PdfPage {
  const items: PdfTextItem[] = [];
  let y = PAGE_H - TOP_MARGIN;
  for (const line of lines) {
    const size = line.fontSize ?? BODY;
    y -= (line.gapBefore ?? 0) * size * 1.2;
    items.push({
      text: line.text,
      x: line.x ?? 50,
      y,
      fontSize: size,
      width: line.text.length * size * 0.5,
    });
    y -= size * 1.2;
  }
  for (const f of furniture ?? []) {
    items.push({
      text: f.text,
      x: f.x ?? 50,
      y: f.fontSize === undefined && f.text.length < 5 ? 20 : PAGE_H - 20,
      fontSize: f.fontSize ?? 9,
      width: f.text.length * 5,
    });
  }
  return { pageNumber, width: PAGE_W, height: PAGE_H, items };
}

describe('reconstructLines', () => {
  it('merges runs on the same baseline and orders lines top to bottom', () => {
    const page: PdfPage = {
      pageNumber: 1,
      width: PAGE_W,
      height: PAGE_H,
      items: [
        { text: 'world', x: 100, y: 700, fontSize: 12, width: 30 },
        { text: 'Hello', x: 50, y: 700, fontSize: 12, width: 30 },
        { text: 'Second line', x: 50, y: 680, fontSize: 12, width: 66 },
      ],
    };
    const lines = reconstructLines(page);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Second line']);
  });

  it('joins kerning-split runs without inserting a space', () => {
    const page: PdfPage = {
      pageNumber: 1,
      width: PAGE_W,
      height: PAGE_H,
      items: [
        { text: 'Chap', x: 50, y: 700, fontSize: 12, width: 28 },
        { text: 'ter', x: 78.4, y: 700, fontSize: 12, width: 20 },
      ],
    };
    expect(reconstructLines(page)[0]!.text).toBe('Chapter');
  });
});

describe('segmentPages', () => {
  it('splits chapters at large-font headings', () => {
    const pages = [
      makePage(1, [
        { text: 'Chapter 1', fontSize: 20 },
        { text: 'It was a dark and stormy night. The rain' },
        { text: 'fell in torrents except at occasional intervals.' },
      ]),
      makePage(2, [
        { text: 'Chapter 2', fontSize: 20 },
        { text: 'The second chapter begins here with more text.' },
      ]),
    ];
    const chapters = segmentPages(pages);
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(chapters[0]!.paragraphs[0]).toContain('dark and stormy');
    expect(chapters[0]!.sourcePages).toEqual({ from: 1, to: 1 });
  });

  it('merges wrapped lines into one paragraph and repairs hyphenation', () => {
    const pages = [
      makePage(1, [
        { text: 'Chapter 1', fontSize: 20 },
        { text: 'The philosophy of language is fasci-' },
        { text: 'nating and rewards careful study.' },
      ]),
    ];
    const [chapter] = segmentPages(pages);
    expect(chapter!.paragraphs).toEqual([
      'The philosophy of language is fascinating and rewards careful study.',
    ]);
  });

  it('starts a new paragraph on indent', () => {
    const pages = [
      makePage(1, [
        { text: 'Chapter 1', fontSize: 20 },
        { text: 'First paragraph ends here.' },
        { text: 'Second paragraph starts indented.', x: 70 },
        { text: 'and continues on the following line.', x: 50 },
      ]),
    ];
    const [chapter] = segmentPages(pages);
    expect(chapter!.paragraphs).toHaveLength(2);
    expect(chapter!.paragraphs[1]).toBe(
      'Second paragraph starts indented. and continues on the following line.',
    );
  });

  it('continues a paragraph across a page break', () => {
    const pages = [
      makePage(1, [
        { text: 'Chapter 1', fontSize: 20 },
        { text: 'This sentence is split across two' },
      ]),
      makePage(2, [{ text: 'pages and should stay together.' }]),
    ];
    const [chapter] = segmentPages(pages);
    expect(chapter!.paragraphs).toEqual([
      'This sentence is split across two pages and should stay together.',
    ]);
    expect(chapter!.sourcePages).toEqual({ from: 1, to: 2 });
  });

  it('strips repeating running heads and page numbers', () => {
    const pages = [1, 2, 3, 4].map((n) =>
      makePage(
        n,
        [{ text: `Body text for page ${n} continues along.` }],
        [
          { text: 'THE GREAT BOOK', fontSize: 9 },
          { text: String(n) },
        ],
      ),
    );
    const chapters = segmentPages(pages);
    const all = chapters.flatMap((c) => c.paragraphs).join(' ');
    expect(all).not.toContain('THE GREAT BOOK');
    expect(all).toContain('Body text for page 3');
  });

  it('falls back to page-range chunks when no headings exist', () => {
    const pages = Array.from({ length: 40 }, (_, i) =>
      makePage(i + 1, [
        { text: `Paragraph on page ${i + 1} with plenty of ordinary body text.` },
        { text: 'More filler text follows here.', gapBefore: 2 },
      ]),
    );
    const chapters = segmentPages(pages, { fallbackChunkPages: 15 });
    expect(chapters.length).toBeGreaterThan(1);
    expect(chapters[0]!.title).toMatch(/^Pages 1–/);
  });

  it('detects textual chapter headings even at body font size', () => {
    const pages = [
      makePage(1, [
        { text: 'Chapter One' },
        { text: 'Body text follows the modest heading here.', gapBefore: 1 },
      ]),
    ];
    const chapters = segmentPages(pages);
    expect(chapters[0]!.title).toBe('Chapter One');
  });

  it('returns an empty list for an empty document', () => {
    expect(segmentPages([])).toEqual([]);
  });
});
