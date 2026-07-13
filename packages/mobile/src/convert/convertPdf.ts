import { segmentPages, type PdfPage } from '@inkread/core';
import { apiFetch } from '../lib/api';
import { syncNow } from '../lib/sync';
import type { PdfMeta } from '../pdf/PdfExtractor';

export interface ConversionResult {
  bookId: string;
  title: string;
}

/**
 * Final step of the import flow: extracted pages → chapters → the API.
 * The server owns the book; the local cache picks it up via sync, so an
 * import on the phone appears on desktop and vice versa.
 */
export async function finishConversion(
  pages: PdfPage[],
  meta: PdfMeta,
  fallbackTitle: string,
): Promise<ConversionResult> {
  const chapters = segmentPages(pages);
  if (chapters.length === 0) {
    throw new Error(
      'No readable text found in this PDF. It may be a scanned document without embedded text.',
    );
  }

  const title = (meta.title ?? '').trim() || fallbackTitle;
  const response = await apiFetch('/api/books', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      author: (meta.author ?? '').trim() || undefined,
      source: 'pdf',
      chapters,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Import failed (${response.status})`);
  }
  const { book } = (await response.json()) as { book: { id: string } };
  await syncNow(true).catch(() => undefined);
  return { bookId: book.id, title };
}
