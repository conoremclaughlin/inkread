/**
 * Cross-page highlight ("extend"): anchor on one selection, then select the far
 * end of the passage — possibly pages later — and the two fold into one range.
 *
 * Folding is a max/min rather than "second selection wins" so the gesture works
 * in either direction: selecting *backwards* from the anchor extends the head,
 * and a second selection that lands inside the anchor can only ever keep the
 * range it already had. The text is sliced from the chapter rather than
 * concatenated from the two selections, so what's saved is the passage as it
 * reads — everything between the endpoints, including what was skipped over.
 */
export interface TextRange {
  start: number;
  end: number;
  text: string;
}

export function foldExtendRange(
  anchor: { start: number; length: number },
  selection: { start: number; end: number },
  chapterText: string,
): TextRange {
  const anchorEnd = anchor.start + anchor.length;
  const start = Math.min(anchor.start, selection.start);
  const end = Math.max(anchorEnd, selection.end);
  return { start, end, text: chapterText.slice(start, end) };
}
