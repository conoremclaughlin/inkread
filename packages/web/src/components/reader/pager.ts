/**
 * Page-turn arithmetic for the paged web reader.
 *
 * The paged view lays the chapter out in CSS columns and slides `#content`
 * horizontally with a compositor transform. Everything about *where* a page
 * lands is plain arithmetic — extracted here so it is unit-tested rather than
 * re-derived inside effects. The component owns only measurement (how wide a
 * column is, how far the content scrolls) and the transform itself.
 */

/** Gutter between columns, in px. Also the visual page margin. */
export const COLUMN_GAP = 88;

/** One page step: a column plus the gutter that follows it. */
export function pageWidth(contentWidth: number, gap: number = COLUMN_GAP): number {
  return Math.max(1, contentWidth + gap);
}

/** Snap an arbitrary scroll position to the nearest page boundary. */
export function pageAt(x: number, step: number): number {
  return Math.round(x / step) * step;
}

export function clampX(x: number, maxX: number): number {
  return Math.max(0, Math.min(maxX, x));
}

export interface Settle {
  /** Where the view should come to rest. */
  x: number;
  /** Set when the turn ran off the chapter — the host flows to the neighbour. */
  edge?: 'prev' | 'next';
}

/**
 * Settle onto the page `delta` steps from `baseX`, or report the chapter edge.
 *
 * At an edge we deliberately return to `base` (a short spring-back) *and* the
 * edge direction: the host decides whether a neighbouring chapter exists, so a
 * book's first and last pages simply bounce.
 */
export function settle(baseX: number, delta: number, step: number, maxX: number): Settle {
  const base = pageAt(baseX, step);
  const target = base + delta * step;
  // The ±1 tolerance absorbs sub-pixel column widths: a "last page" can compute
  // a hair past maxX without actually being off the end.
  if (target < -1) return { x: clampX(base, maxX), edge: 'prev' };
  if (target > maxX + 1) return { x: clampX(base, maxX), edge: 'next' };
  return { x: clampX(target, maxX) };
}

/**
 * Where to *draw* the content mid-drag. Past either end the page keeps
 * following the thumb at a fraction of the distance — the rubber-band that
 * makes a pager feel physical — while the logical position stays clamped.
 */
export function rubberBand(raw: number, maxX: number, factor = 0.4): number {
  if (raw < 0) return raw * factor;
  if (raw > maxX) return maxX + (raw - maxX) * factor;
  return raw;
}

/**
 * Does a finished drag turn a page? Either it travelled far enough (>22% of a
 * page), or it was a flick — short, fast, and decisive. Dragging left (negative
 * dx) pulls the *next* page in.
 */
export function dragTurn(dx: number, elapsedMs: number, step: number): -1 | 0 | 1 {
  const flick = Math.abs(dx) > 40 && elapsedMs < 250;
  if (Math.abs(dx) <= step * 0.22 && !flick) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Is a drag horizontal enough to be a page turn? Below the 8px threshold the
 * gesture hasn't declared itself yet (null); after that, horizontal has to beat
 * vertical by a clear margin so a slightly-angled scroll still scrolls.
 */
export function dragAxis(dx: number, dy: number): 'horizontal' | 'vertical' | null {
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical';
}

/** Which third of the viewport a tap landed in — the paged edge-tap zones. */
export function tapZone(x: number, width: number): 'prev' | 'next' | 'center' {
  const ratio = x / Math.max(1, width);
  if (ratio < 0.18) return 'prev';
  if (ratio > 0.82) return 'next';
  return 'center';
}
