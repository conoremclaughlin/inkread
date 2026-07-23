import { describe, expect, it } from 'vitest';
import type { Annotation, BookMeta } from '../models/types';
import { exportAnnotationsCsv } from './csv';

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

describe('exportAnnotationsCsv', () => {
  it('emits a header row and one row per annotation in reading order', () => {
    const csv = exportAnnotationsCsv(BOOK, [
      annotation({ id: 'a2', locator: { chapterIndex: 1, start: 0, end: 5 }, passage: 'Later.' }),
      annotation({ id: 'a1', locator: { chapterIndex: 0, start: 0, end: 5 }, passage: 'Earlier.' }),
    ]);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows[0]).toBe('Passage,Note,Color,Chapter,Book,Author,Date');
    expect(rows).toHaveLength(3);
    // Reading order: chapter 0 before chapter 1.
    expect(rows[1]!.startsWith('Earlier.,')).toBe(true);
    expect(rows[2]!.startsWith('Later.,')).toBe(true);
  });

  it('quotes and escapes fields containing commas, quotes, or newlines', () => {
    const csv = exportAnnotationsCsv(BOOK, [
      annotation({
        passage: 'He said, "hello"',
        note: 'line one\nline two',
      }),
    ]);
    const row = csv.trimEnd().split('\r\n')[1]!;
    // Comma + doubled quotes inside a quoted cell; newline preserved in a quoted cell.
    expect(row).toContain('"He said, ""hello"""');
    expect(row).toContain('"line one\nline two"');
  });

  it('falls back to "Chapter N" and leaves optional fields empty', () => {
    const csv = exportAnnotationsCsv(
      { ...BOOK, author: undefined },
      [annotation({ chapterTitle: undefined, note: undefined, locator: { chapterIndex: 2, start: 0, end: 3 } })],
    );
    const row = csv.trimEnd().split('\r\n')[1]!;
    const cells = row.split(',');
    expect(cells[1]).toBe(''); // Note empty
    expect(cells[3]).toBe('Chapter 3'); // 1-based fallback
    expect(cells[5]).toBe(''); // Author empty
  });

  it('handles a book with no annotations (header only)', () => {
    const csv = exportAnnotationsCsv(BOOK, []);
    expect(csv).toBe('Passage,Note,Color,Chapter,Book,Author,Date\r\n');
  });
});
