import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { PdfPage, PdfTextItem } from '../models/types';
import { buildEpub } from '../epub/builder';
import { segmentPages } from './segment';

/**
 * End-to-end check against the real pdf.js: build a small PDF by hand,
 * extract text with pdfjs-dist exactly the way the app's WebView extractor
 * does (same item normalization), then run segmentation and EPUB assembly.
 * This pins our assumptions about pdf.js transforms and coordinates.
 */

interface PdfTextOp {
  x: number;
  y: number;
  size: number;
  text: string;
}

function contentStream(ops: PdfTextOp[]): string {
  return ops
    .map(
      (op) =>
        `BT /F1 ${op.size} Tf ${op.x} ${op.y} Td (${op.text.replace(/([()\\])/g, '\\$1')}) Tj ET`,
    )
    .join('\n');
}

/** Minimal but valid single-font PDF with one content stream per page. */
function buildTestPdf(pages: PdfTextOp[][]): Uint8Array {
  const objects: string[] = [];
  const pageRefs = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>\nendobj\n`,
  );
  objects.push(
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  );
  pages.forEach((ops, i) => {
    const pageNum = 4 + i * 2;
    const contentNum = pageNum + 1;
    objects.push(
      `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
    );
    const stream = contentStream(ops);
    objects.push(
      `${contentNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref + trailer);
}

/** Mirrors the normalization in packages/mobile/src/pdf/extractorHtml.ts. */
async function extractWithPdfjs(bytes: Uint8Array): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await loadingTask.promise;
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
  }
  await loadingTask.destroy();
  return pages;
}

describe('pdf.js → segmentation → epub (integration)', () => {
  it('converts a two-chapter PDF into a valid EPUB', async () => {
    const pdf = buildTestPdf([
      [
        { x: 72, y: 700, size: 24, text: 'Chapter 1' },
        { x: 72, y: 660, size: 12, text: 'It was a dark and stormy night. The rain fell' },
        { x: 72, y: 644, size: 12, text: 'in torrents and the wind howled all around.' },
      ],
      [
        { x: 72, y: 700, size: 24, text: 'Chapter 2' },
        { x: 72, y: 660, size: 12, text: 'The second chapter begins with calmer weather.' },
      ],
    ]);

    const pages = await extractWithPdfjs(pdf);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.items.length).toBeGreaterThanOrEqual(3);

    const chapters = segmentPages(pages);
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
    expect(chapters[0]!.paragraphs.join(' ')).toContain(
      'dark and stormy night. The rain fell in torrents',
    );

    const epub = buildEpub({
      title: 'Integration Test',
      identifier: 'urn:inkread:test',
      modified: '2026-07-03T00:00:00Z',
      chapters,
    });
    const files = unzipSync(epub);
    expect(strFromU8(files['mimetype']!)).toBe('application/epub+zip');
    expect(strFromU8(files['OEBPS/text/chapter-001.xhtml']!)).toContain('dark and stormy');
  });

  it('handles PDFs whose lines are split into many small runs', async () => {
    // Words placed as separate ops on one baseline: line reconstruction must join them.
    const words = ['Chapter', '1'];
    const bodyWords = ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog.'];
    const pdf = buildTestPdf([
      [
        ...words.map((w, i) => ({ x: 72 + i * 90, y: 700, size: 20, text: w })),
        ...bodyWords.map((w, i) => ({ x: 72 + i * 50, y: 660, size: 12, text: w })),
      ],
    ]);
    const pages = await extractWithPdfjs(pdf);
    const chapters = segmentPages(pages);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe('Chapter 1');
    expect(chapters[0]!.paragraphs[0]).toBe('The quick brown fox jumps over the lazy dog.');
  });
});
