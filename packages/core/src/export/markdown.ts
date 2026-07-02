import type { Annotation, BookMeta } from '../models/types';

/**
 * Turning annotations back OUT of the app is a first-class feature:
 * Markdown that pastes cleanly into Notion, Obsidian, or an email.
 */

function sortAnnotations(annotations: Annotation[]): Annotation[] {
  return annotations
    .slice()
    .sort(
      (a, b) =>
        a.locator.chapterIndex - b.locator.chapterIndex ||
        a.locator.start - b.locator.start,
    );
}

/**
 * All highlights and notes for a book as a single Markdown document,
 * grouped by chapter, in reading order.
 */
export function exportAnnotationsMarkdown(
  book: BookMeta,
  annotations: Annotation[],
): string {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  if (book.author) lines.push(`*by ${book.author}*`);
  lines.push('');

  if (annotations.length === 0) {
    lines.push('_No highlights or notes yet._');
    return lines.join('\n');
  }

  const ordered = sortAnnotations(annotations);
  let currentChapter: number | undefined;
  for (const annotation of ordered) {
    if (annotation.locator.chapterIndex !== currentChapter) {
      currentChapter = annotation.locator.chapterIndex;
      const title =
        annotation.chapterTitle ?? `Chapter ${annotation.locator.chapterIndex + 1}`;
      lines.push(`## ${title}`);
      lines.push('');
    }
    const quoted = annotation.passage
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    lines.push(quoted);
    if (annotation.note) {
      lines.push('');
      lines.push(`**Note:** ${annotation.note}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** A single passage formatted for the share sheet, with attribution. */
export function formatPassageShare(
  book: BookMeta,
  passage: string,
  note?: string,
): string {
  const parts: string[] = [`“${passage.trim()}”`];
  if (note && note.trim().length > 0) {
    parts.push('');
    parts.push(note.trim());
  }
  parts.push('');
  parts.push(book.author ? `— ${book.title}, ${book.author}` : `— ${book.title}`);
  return parts.join('\n');
}
