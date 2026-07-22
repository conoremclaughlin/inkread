import type { Annotation, BookMeta } from '../models/types';
import { chapterLabel, sortAnnotations } from './markdown';

/**
 * Annotations as CSV — one row per highlight/note, in reading order. Imports
 * straight into a Notion database (or Sheets/Excel): the first column,
 * Passage, becomes each row's title. Complements the Markdown export, which is
 * for pasting prose into a page.
 */

/** RFC 4180 cell: quote when it holds a comma, quote, or newline; double quotes. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

const CSV_HEADER = ['Passage', 'Note', 'Color', 'Chapter', 'Book', 'Author', 'Date'];

export function exportAnnotationsCsv(book: BookMeta, annotations: Annotation[]): string {
  const rows = sortAnnotations(annotations).map((annotation) =>
    csvRow([
      annotation.passage,
      annotation.note ?? '',
      annotation.color,
      chapterLabel(annotation),
      book.title,
      book.author ?? '',
      annotation.createdAt,
    ]),
  );
  // CRLF line endings per RFC 4180 — the most import-tool-friendly.
  return [csvRow(CSV_HEADER), ...rows].join('\r\n') + '\r\n';
}
