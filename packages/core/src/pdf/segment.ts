import type { Chapter, PdfPage, PdfTextItem } from '../models/types';

/**
 * PDF text → reflowable chapters.
 *
 * Input is the normalized page/item stream from any extractor (pdf.js in the
 * app, pdfjs-dist in tests). The pipeline:
 *
 *   1. Reconstruct visual lines from positioned items.
 *   2. Strip repeating headers/footers and bare page numbers.
 *   3. Detect chapter headings (font size vs. body mode + textual patterns).
 *   4. Merge lines into paragraphs (vertical gaps, indents, hyphen repair).
 *   5. Split into chapters at headings; fall back to page-range chunks.
 */

export interface SegmentOptions {
  /** Fraction of page height treated as header/footer band. Default 0.08. */
  edgeBand?: number;
  /** Minimum share of pages a line must repeat on to count as furniture. Default 0.3. */
  repeatThreshold?: number;
  /** Heading font-size multiplier over body size. Default 1.2. */
  headingScale?: number;
  /** Pages per fallback chunk when no headings are found. Default 15. */
  fallbackChunkPages?: number;
}

interface Line {
  text: string;
  y: number;
  x: number;
  fontSize: number;
  pageNumber: number;
  pageHeight: number;
}

const DEFAULTS: Required<SegmentOptions> = {
  edgeBand: 0.08,
  repeatThreshold: 0.3,
  headingScale: 1.2,
  fallbackChunkPages: 15,
};

/** Group positioned items into visual lines (same baseline, left→right). */
export function reconstructLines(page: PdfPage): Line[] {
  const items = page.items
    .filter((it) => it.text.trim().length > 0)
    .slice()
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: { items: PdfTextItem[]; y: number }[] = [];
  for (const item of items) {
    const tolerance = Math.max(2, item.fontSize * 0.45);
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - item.y) <= tolerance) {
      current.items.push(item);
      continue;
    }
    lines.push({ items: [item], y: item.y });
  }

  return lines.map((line) => {
    const sorted = line.items.slice().sort((a, b) => a.x - b.x);
    let text = '';
    let prev: PdfTextItem | undefined;
    for (const item of sorted) {
      if (prev) {
        const prevEnd = prev.width !== undefined ? prev.x + prev.width : undefined;
        const gap = prevEnd !== undefined ? item.x - prevEnd : Number.POSITIVE_INFINITY;
        // Wide gap → real space; tiny/negative gap → same word split by kerning.
        const needsSpace =
          gap === Number.POSITIVE_INFINITY
            ? !text.endsWith(' ') && !item.text.startsWith(' ')
            : gap > Math.max(1, prev.fontSize * 0.12);
        if (needsSpace && !text.endsWith(' ') && !item.text.startsWith(' ')) {
          text += ' ';
        }
      }
      text += item.text;
      prev = item;
    }
    const first = sorted[0]!;
    const fontSize = Math.max(...sorted.map((i) => i.fontSize));
    return {
      text: text.replace(/\s+/g, ' ').trim(),
      y: line.y,
      x: first.x,
      fontSize,
      pageNumber: page.pageNumber,
      pageHeight: page.height,
    };
  });
}

/** Normalize a line for repeat-detection: case-fold, strip digits so "Page 12"/"Page 13" match. */
function furnitureKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function isBarePageNumber(text: string): boolean {
  return /^[\divxlcIVXLC]{1,7}$/.test(text.trim());
}

/**
 * Remove running headers/footers and page numbers: lines inside the top or
 * bottom edge band whose normalized text repeats across many pages, plus any
 * bare page numbers in the band.
 */
export function stripFurniture(
  pagesLines: Line[][],
  bodySize: number,
  options: Required<SegmentOptions>,
): Line[][] {
  const pageCount = pagesLines.length;
  const repeatCounts = new Map<string, number>();

  const inBand = (line: Line): boolean => {
    const band = line.pageHeight * options.edgeBand;
    return line.y >= line.pageHeight - band || line.y <= band;
  };

  for (const lines of pagesLines) {
    const seen = new Set<string>();
    for (const line of lines) {
      if (!inBand(line)) continue;
      const key = furnitureKey(line.text);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      repeatCounts.set(key, (repeatCounts.get(key) ?? 0) + 1);
    }
  }

  const minRepeats = Math.max(2, Math.ceil(pageCount * options.repeatThreshold));
  return pagesLines.map((lines) =>
    lines.filter((line) => {
      if (!inBand(line)) return true;
      if (isBarePageNumber(line.text)) return false;
      // Furniture is set at body size or smaller — never strip heading-sized text.
      if (line.fontSize > bodySize * 1.1) return true;
      return (repeatCounts.get(furnitureKey(line.text)) ?? 0) < minRepeats;
    }),
  );
}

/** Body font size = mode of line font sizes weighted by text length. */
export function bodyFontSize(lines: Line[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.fontSize * 2) / 2;
    weights.set(size, (weights.get(size) ?? 0) + line.text.length);
  }
  let best = 12;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

const HEADING_PATTERN =
  /^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|appendix|acknowledg|contents|glossary|index)\b/i;
const NUMBERED_HEADING = /^\d{1,3}(\.\d{1,3})*\.?\s+\S/;

export function isHeading(line: Line, bodySize: number, options: Required<SegmentOptions>): boolean {
  const text = line.text;
  if (text.length === 0 || text.length > 80) return false;
  const larger = line.fontSize >= bodySize * options.headingScale;
  if (HEADING_PATTERN.test(text) && (larger || text.length < 40)) return true;
  if (!larger) return false;
  // Large font alone: accept short standalone lines that don't end mid-sentence.
  if (/[.,;:]$/.test(text) && !/^\d+\.$/.test(text)) return false;
  return text.length <= 60 || NUMBERED_HEADING.test(text);
}

/** Join a hyphen-broken line ending onto the next line's start. */
function joinLineTexts(previous: string, next: string): string {
  if (/[A-Za-zÀ-ÿ]-$/.test(previous) && /^[a-zà-ÿ]/.test(next)) {
    return previous.slice(0, -1) + next;
  }
  return `${previous} ${next}`;
}

interface Block {
  kind: 'heading' | 'paragraph';
  text: string;
  pageNumber: number;
  /** Last source page the block touches (paragraphs can span page breaks). */
  endPage: number;
}

/** Merge consecutive body lines into paragraph blocks; headings pass through. */
export function buildBlocks(
  pagesLines: Line[][],
  bodySize: number,
  options: Required<SegmentOptions>,
): Block[] {
  const blocks: Block[] = [];
  let paragraph = '';
  let paragraphPage = 0;
  let paragraphEndPage = 0;
  let prevLine: Line | undefined;

  const flush = (): void => {
    const text = paragraph.trim();
    if (text.length > 0) {
      blocks.push({
        kind: 'paragraph',
        text,
        pageNumber: paragraphPage,
        endPage: paragraphEndPage,
      });
    }
    paragraph = '';
  };

  for (const lines of pagesLines) {
    for (const line of lines) {
      if (isHeading(line, bodySize, options)) {
        flush();
        blocks.push({
          kind: 'heading',
          text: line.text,
          pageNumber: line.pageNumber,
          endPage: line.pageNumber,
        });
        prevLine = undefined;
        continue;
      }

      let newParagraph = false;
      if (paragraph.length === 0) {
        newParagraph = true;
      } else if (prevLine && prevLine.pageNumber === line.pageNumber) {
        const gap = prevLine.y - line.y;
        const lineHeight = Math.max(prevLine.fontSize, line.fontSize) * 1.15;
        const indented = line.x - prevLine.x > line.fontSize * 0.9;
        if (gap > lineHeight * 1.6 || indented) newParagraph = true;
      } else if (prevLine && prevLine.pageNumber !== line.pageNumber) {
        // Across a page break: continue the paragraph unless the previous
        // line clearly ended a sentence and the new one starts a fresh one.
        const ended = /[.!?"'”’]$/.test(paragraph);
        const startsUpper = /^[A-Z"'“‘]/.test(line.text);
        // Indented first line on the new page is a strong paragraph signal.
        newParagraph = ended && startsUpper;
      }

      if (newParagraph) {
        flush();
        paragraph = line.text;
        paragraphPage = line.pageNumber;
      } else {
        paragraph = joinLineTexts(paragraph, line.text);
      }
      paragraphEndPage = line.pageNumber;
      prevLine = line;
    }
  }
  flush();
  return blocks;
}

/** Split blocks into chapters at headings; merge tiny leading fragments. */
function blocksToChapters(blocks: Block[], options: Required<SegmentOptions>): Chapter[] {
  const chapters: Chapter[] = [];
  let current: { title: string; paragraphs: string[]; from: number; to: number } | undefined;

  const push = (): void => {
    if (!current) return;
    if (current.paragraphs.length > 0 || chapters.length > 0) {
      chapters.push({
        title: current.title,
        paragraphs: current.paragraphs,
        sourcePages: { from: current.from, to: current.to },
      });
    }
    current = undefined;
  };

  for (const block of blocks) {
    if (block.kind === 'heading') {
      push();
      current = {
        title: block.text,
        paragraphs: [],
        from: block.pageNumber,
        to: block.pageNumber,
      };
    } else {
      if (!current) {
        current = { title: 'Beginning', paragraphs: [], from: block.pageNumber, to: block.endPage };
      }
      current.paragraphs.push(block.text);
      current.to = block.endPage;
    }
  }
  push();

  const substantial = chapters.filter((c) => c.paragraphs.length > 0);
  if (substantial.length === 0 && chapters.length === 0) return [];

  // No headings at all → chunk by page ranges so chapters stay manageable.
  if (chapters.length === 1 && chapters[0]!.title === 'Beginning') {
    return chunkByPages(blocks, options);
  }
  return chapters;
}

function chunkByPages(blocks: Block[], options: Required<SegmentOptions>): Chapter[] {
  const chapters: Chapter[] = [];
  let paragraphs: string[] = [];
  let from = blocks[0]?.pageNumber ?? 1;
  let to = from;

  for (const block of blocks) {
    if (block.pageNumber - from >= options.fallbackChunkPages && paragraphs.length > 0) {
      chapters.push({ title: `Pages ${from}–${to}`, paragraphs, sourcePages: { from, to } });
      paragraphs = [];
      from = block.pageNumber;
    }
    paragraphs.push(block.text);
    to = block.endPage;
  }
  if (paragraphs.length > 0) {
    chapters.push({ title: `Pages ${from}–${to}`, paragraphs, sourcePages: { from, to } });
  }
  return chapters;
}

/** Full pipeline: normalized PDF pages → reflowable chapters. */
export function segmentPages(pages: PdfPage[], options?: SegmentOptions): Chapter[] {
  const opts: Required<SegmentOptions> = { ...DEFAULTS, ...options };
  const rawLines = pages.map((page) => reconstructLines(page));
  const allRaw = rawLines.flat();
  if (allRaw.length === 0) return [];
  const bodySize = bodyFontSize(allRaw);
  const pagesLines = stripFurniture(rawLines, bodySize, opts);
  if (pagesLines.flat().length === 0) return [];
  const blocks = buildBlocks(pagesLines, bodySize, opts);
  return blocksToChapters(blocks, opts);
}
