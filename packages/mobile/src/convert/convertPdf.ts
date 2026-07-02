import { buildEpub, segmentPages, type Chapter, type PdfPage } from '@inkread/core';
import { newId } from '../lib/id';
import { insertBook, type BookRecord } from '../store/db';
import { saveSourcePdf, writeChapters, writeEpub } from '../store/files';
import type { PdfMeta } from '../pdf/PdfExtractor';

export interface ConversionResult {
  book: BookRecord;
  chapters: Chapter[];
}

/**
 * Final step of the import flow: extracted pages → chapters → EPUB → library.
 * Extraction itself is driven by the PdfExtractor WebView; this function is
 * pure orchestration once pages are in hand.
 */
export function finishConversion(
  pages: PdfPage[],
  meta: PdfMeta,
  fallbackTitle: string,
  sourcePdfUri: string,
): ConversionResult {
  const chapters = segmentPages(pages);
  if (chapters.length === 0) {
    throw new Error(
      'No readable text found in this PDF. It may be a scanned document without embedded text.',
    );
  }

  const id = newId('book');
  const title = (meta.title ?? '').trim() || fallbackTitle;
  const author = (meta.author ?? '').trim() || undefined;
  const createdAt = new Date().toISOString();

  const epub = buildEpub({
    title,
    author,
    identifier: `urn:inkread:${id}`,
    modified: createdAt.replace(/\.\d{3}Z$/, 'Z'),
    chapters,
  });

  writeChapters(id, chapters);
  writeEpub(id, epub);
  saveSourcePdf(id, sourcePdfUri);

  const book: BookRecord = {
    id,
    title,
    author,
    language: 'en',
    source: 'pdf',
    chapterCount: chapters.length,
    createdAt,
  };
  insertBook(book);
  return { book, chapters };
}
