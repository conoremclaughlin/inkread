import { Directory, File, Paths } from 'expo-file-system';
import type { Chapter } from '@inkread/core';

/**
 * On-disk layout, under the app documents directory:
 *
 *   books/<bookId>/book.json     — chapters as JSON (what the reader renders)
 *   books/<bookId>/book.epub     — generated EPUB (for export/interop)
 *   books/<bookId>/source.pdf    — original import, kept for provenance
 */

function bookDir(bookId: string): Directory {
  return new Directory(Paths.document, 'books', bookId);
}

export function ensureBookDir(bookId: string): Directory {
  const dir = bookDir(bookId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function writeChapters(bookId: string, chapters: Chapter[]): void {
  ensureBookDir(bookId);
  new File(bookDir(bookId), 'book.json').write(JSON.stringify({ chapters }));
}

export function readChapters(bookId: string): Chapter[] {
  const file = new File(bookDir(bookId), 'book.json');
  const parsed = JSON.parse(file.textSync()) as { chapters: Chapter[] };
  return parsed.chapters;
}

export function writeEpub(bookId: string, epub: Uint8Array): File {
  ensureBookDir(bookId);
  const file = new File(bookDir(bookId), 'book.epub');
  file.write(epub);
  return file;
}

export function epubFile(bookId: string): File {
  return new File(bookDir(bookId), 'book.epub');
}

export function saveSourcePdf(bookId: string, sourceUri: string): void {
  ensureBookDir(bookId);
  const target = new File(bookDir(bookId), 'source.pdf');
  if (target.exists) target.delete();
  new File(sourceUri).copySync(target);
}

export function deleteBookFiles(bookId: string): void {
  const dir = bookDir(bookId);
  if (dir.exists) dir.delete();
}

/** Write a temp file (e.g. exported Markdown) into the cache dir for sharing. */
export function writeShareFile(name: string, contents: string): File {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.write(contents);
  return file;
}
