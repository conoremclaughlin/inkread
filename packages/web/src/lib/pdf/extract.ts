import type { PdfPage, PdfTextItem } from '@inkread/core';

/**
 * Browser-side PDF text extraction with pdf.js. Runs in the page (client
 * component); item normalization matches the mobile extractor and the core
 * integration tests.
 */
export async function extractPdfPages(
  data: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<{ pages: PdfPage[]; title?: string; author?: string }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  let title: string | undefined;
  let author: string | undefined;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: string; Author?: string };
    title = info.Title || undefined;
    author = info.Author || undefined;
  } catch {
    // metadata is optional
  }

  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item) || typeof item.str !== 'string' || item.str.length === 0) continue;
      const t = item.transform as number[];
      items.push({
        text: item.str,
        x: t[4]!,
        y: t[5]!,
        fontSize: Math.hypot(t[2]!, t[3]!) || item.height || 12,
        width: item.width,
        fontName: item.fontName,
      });
    }
    pages.push({ pageNumber: n, width: viewport.width, height: viewport.height, items });
    page.cleanup();
    onProgress?.(n, doc.numPages);
  }
  await loadingTask.destroy();
  return { pages, title, author };
}
