import type { Annotation } from '../models/types';

/**
 * Shared highlight-run segmentation — the offset model behind both readers.
 *
 * A chapter's "plain text" is `paragraphs.join('\n')`; every annotation locator
 * is a [start, end) range in that text. Splitting each paragraph at annotation
 * boundaries yields a flat list of runs (plain, or carrying the annotation that
 * covers them). The WebView reader turns runs into `<span>`s; the native reader
 * turns them into nested `<Text>` children. Same math, one source of truth — so
 * a highlight lands on exactly the same characters whichever engine renders it.
 */

export interface Run {
  text: string;
  /** The annotation covering this run, if any (drives colour + note underline). */
  annotation?: Annotation;
}

export interface ParagraphRuns {
  /** Character offset of this paragraph within `paragraphs.join('\n')`. */
  start: number;
  runs: Run[];
}

/** Split one paragraph's text into plain/highlighted runs at annotation boundaries. */
export function segmentParagraph(
  text: string,
  paragraphStart: number,
  annotations: Annotation[],
): Run[] {
  const paragraphEnd = paragraphStart + text.length;
  const overlapping = annotations
    .filter((a) => a.locator.start < paragraphEnd && a.locator.end > paragraphStart)
    .sort((a, b) => a.locator.start - b.locator.start);
  if (overlapping.length === 0) return [{ text }];

  const runs: Run[] = [];
  let cursor = 0;
  for (const annotation of overlapping) {
    const start = Math.max(0, annotation.locator.start - paragraphStart);
    const end = Math.min(text.length, annotation.locator.end - paragraphStart);
    if (start > cursor) runs.push({ text: text.slice(cursor, start) });
    if (end > Math.max(start, cursor)) {
      runs.push({ text: text.slice(Math.max(start, cursor), end), annotation });
      cursor = end;
    }
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs;
}

/**
 * Segment every paragraph of a chapter, tracking each paragraph's start offset
 * (so a host can map a tapped/scrolled position back to a character offset).
 */
export function segmentChapterRuns(
  paragraphs: string[],
  annotations: Annotation[],
): ParagraphRuns[] {
  let offset = 0;
  return paragraphs.map((text) => {
    const start = offset;
    const runs = segmentParagraph(text, offset, annotations);
    offset += text.length + 1; // +1 for the '\n' join separator
    return { start, runs };
  });
}
