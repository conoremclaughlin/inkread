/**
 * Pure pagination for the native reader.
 *
 * React Native's <Text onTextLayout> reports every laid-out line as a box with
 * a `y` (top, relative to the text block) and a `height`. Given those boxes and
 * the height of the reading viewport, this groups the lines into pages that each
 * fit the viewport *without splitting a line*. It's the algorithmic core of a
 * native reader: measure the chapter once, paginate here, then show page N by
 * translating the text block up by `pages[N].top` and clipping to the viewport.
 *
 * Kept pure (no RN, no DOM) so it's fully testable in Node — the layout math is
 * where a paginated reader lives or dies, so it earns real tests before any
 * pixels are involved.
 */

/** A single laid-out line, as onTextLayout reports it (only y/height matter). */
export interface LineBox {
  y: number;
  height: number;
}

export interface Page {
  /** Index of the first line on the page (inclusive). */
  firstLine: number;
  /** Index of the last line on the page (inclusive). */
  lastLine: number;
  /** Y offset to translate the text block up by so this page starts at the top. */
  top: number;
}

/**
 * Group lines into pages that fit `viewportHeight`. A line never straddles a
 * page boundary; a single line taller than the viewport still gets its own page
 * (so pagination always makes progress and never loses content).
 */
export function paginate(lines: LineBox[], viewportHeight: number): Page[] {
  const pages: Page[] = [];
  if (viewportHeight <= 0) return pages;

  let i = 0;
  while (i < lines.length) {
    const top = lines[i]!.y;
    const limit = top + viewportHeight;
    let last = i;
    while (last + 1 < lines.length) {
      const next = lines[last + 1]!;
      if (next.y + next.height > limit) break;
      last++;
    }
    pages.push({ firstLine: i, lastLine: last, top });
    i = last + 1;
  }
  return pages;
}

/** The 0-based page index a given line falls on (−1 if out of range). */
export function pageOfLine(pages: Page[], lineIndex: number): number {
  return pages.findIndex((p) => lineIndex >= p.firstLine && lineIndex <= p.lastLine);
}
