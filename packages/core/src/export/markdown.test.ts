import { describe, expect, it } from 'vitest';
import type { Annotation, BookMeta } from '../models/types';
import { exportAnnotationsMarkdown, formatPassageShare } from './markdown';

const BOOK: BookMeta = {
  id: 'b1',
  title: 'Thinking in Systems',
  author: 'Donella Meadows',
  source: 'pdf',
  createdAt: '2026-07-01T00:00:00Z',
};

function annotation(overrides: Partial<Annotation>): Annotation {
  return {
    id: 'a1',
    bookId: 'b1',
    kind: 'highlight',
    locator: { chapterIndex: 0, start: 0, end: 10 },
    passage: 'A system is more than the sum of its parts.',
    color: 'yellow',
    createdAt: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

describe('exportAnnotationsMarkdown', () => {
  it('groups annotations by chapter in reading order', () => {
    const md = exportAnnotationsMarkdown(BOOK, [
      annotation({
        id: 'a2',
        locator: { chapterIndex: 1, start: 5, end: 20 },
        chapterTitle: 'Chapter Two',
        passage: 'Later passage.',
      }),
      annotation({
        id: 'a1',
        locator: { chapterIndex: 0, start: 40, end: 60 },
        chapterTitle: 'Chapter One',
        passage: 'Second in chapter one.',
      }),
      annotation({
        id: 'a0',
        locator: { chapterIndex: 0, start: 0, end: 10 },
        chapterTitle: 'Chapter One',
        passage: 'First in chapter one.',
        note: 'Key insight!',
        kind: 'note',
      }),
    ]);

    expect(md).toContain('# Thinking in Systems');
    expect(md).toContain('*by Donella Meadows*');
    const chapterOnePos = md.indexOf('## Chapter One');
    const chapterTwoPos = md.indexOf('## Chapter Two');
    expect(chapterOnePos).toBeGreaterThan(-1);
    expect(chapterTwoPos).toBeGreaterThan(chapterOnePos);
    expect(md.indexOf('First in chapter one')).toBeLessThan(
      md.indexOf('Second in chapter one'),
    );
    expect(md).toContain('> First in chapter one.');
    expect(md).toContain('**Note:** Key insight!');
    // Only one heading per chapter even with multiple annotations.
    expect(md.match(/## Chapter One/g)).toHaveLength(1);
  });

  it('handles a book with no annotations', () => {
    const md = exportAnnotationsMarkdown(BOOK, []);
    expect(md).toContain('_No highlights or notes yet._');
  });

  it('quotes multi-line passages line by line', () => {
    const md = exportAnnotationsMarkdown(BOOK, [
      annotation({ passage: 'Line one.\nLine two.' }),
    ]);
    expect(md).toContain('> Line one.\n> Line two.');
  });
});

describe('formatPassageShare', () => {
  it('quotes the passage with book attribution', () => {
    const text = formatPassageShare(BOOK, 'A system is more than the sum of its parts.');
    expect(text).toBe(
      '“A system is more than the sum of its parts.”\n\n— Thinking in Systems, Donella Meadows',
    );
  });

  it('includes the note between passage and attribution', () => {
    const text = formatPassageShare(BOOK, 'Passage.', 'My thought.');
    expect(text).toBe('“Passage.”\n\nMy thought.\n\n— Thinking in Systems, Donella Meadows');
  });

  it('omits the author when unknown', () => {
    const text = formatPassageShare({ ...BOOK, author: undefined }, 'Passage.');
    expect(text).toContain('— Thinking in Systems');
    expect(text).not.toContain(',');
  });
});
