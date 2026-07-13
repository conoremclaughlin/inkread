import type { Chapter } from '../models/types';
import { textToChapters, type TextToChaptersOptions } from '../text/segment';

/**
 * Importer for Google Docs plain-text exports (`files.export`, text/plain).
 *
 * Docs exports carry artifacts that generic text handling shouldn't know
 * about: a UTF-8 BOM, inline comment/suggestion markers ([a], [b], … [aa],
 * [ab] after 26), and no soft-wrapping — every line is a full paragraph.
 */

/** Strip Google Docs export artifacts, preserving the actual prose. */
export function cleanGoogleDocText(raw: string): string {
  return (
    raw
      .replace(/^﻿/, '')
      // Comment markers come in runs at the anchor point; strip only
      // short lowercase refs so bracketed prose like [sic] survives runs
      // of actual content.
      .replace(/(?:\[[a-z]{1,2}\])+/g, '')
  );
}

function normalizeForCompare(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Google Docs text → chapters. Headings default to markdown-only since raw
 * Docs prose regularly contains shouty lines that misread as headings;
 * callers that exported structured docs can override. When the first line
 * repeats the document title (Docs exports usually do), it is dropped.
 */
export function googleDocToChapters(
  raw: string,
  fallbackTitle: string,
  options?: TextToChaptersOptions,
): Chapter[] {
  let text = cleanGoogleDocText(raw);
  const newline = text.indexOf('\n');
  const firstLine = normalizeForCompare(newline === -1 ? text : text.slice(0, newline));
  const title = normalizeForCompare(fallbackTitle);
  if (
    firstLine.length > 0 &&
    title.length > 0 &&
    (title.includes(firstLine) || firstLine.includes(title))
  ) {
    text = newline === -1 ? '' : text.slice(newline + 1);
  }
  return textToChapters(text, fallbackTitle, {
    headings: 'markdown',
    paragraphBreaks: 'every-line',
    ...options,
  });
}
