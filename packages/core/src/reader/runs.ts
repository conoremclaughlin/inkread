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

/** A run further split by the transient TTS sentence mark (read-along tint). */
export interface MarkedRun extends Run {
  /** True when this run falls inside the current TTS sentence mark. */
  marked?: boolean;
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
 * Overlay a transient TTS sentence mark onto a paragraph's annotation runs.
 *
 * The mark is the sentence currently being read aloud — a [start, end) range in
 * chapter text (matching `ParagraphRuns.start`). We split each run at the mark's
 * boundaries and tag the covered slices `marked`, layering *on top of* whatever
 * annotation a run already carries (so a spoken sentence inside a highlight
 * keeps its highlight colour and gains the read-along tint). With no mark — or a
 * mark that misses this paragraph — the original runs are returned unchanged
 * (same array reference, so a memoised paragraph can skip re-rendering).
 */
export function applyMark(
  runs: Run[],
  paragraphStart: number,
  mark?: { start: number; end: number },
): MarkedRun[] {
  if (!mark || mark.end <= mark.start) return runs;
  const result: MarkedRun[] = [];
  let offset = paragraphStart;
  let touched = false;
  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;
    const from = Math.max(runStart, mark.start);
    const to = Math.min(runEnd, mark.end);
    if (to <= from) {
      result.push(run); // no overlap with the mark
      continue;
    }
    touched = true;
    const a = from - runStart;
    const b = to - runStart;
    if (a > 0) result.push({ ...run, text: run.text.slice(0, a) });
    result.push({ ...run, text: run.text.slice(a, b), marked: true });
    if (b < run.text.length) result.push({ ...run, text: run.text.slice(b) });
  }
  return touched ? result : runs;
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
