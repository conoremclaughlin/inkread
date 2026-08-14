/**
 * The native paged reader renders paragraphs separated by a blank line ('\n\n')
 * for readable spacing, while the shared offset model joins them with a single
 * '\n'. So paragraph `i` starts `i` characters later in the rendered text than
 * in the model. These helpers convert a rendered selection offset back to the
 * model offset an annotation locator expects.
 */

/** Rendered start offset of each paragraph, given its model start (`+ i`). */
export function renderedParagraphStarts(modelStarts: number[]): number[] {
  return modelStarts.map((start, i) => start + i);
}

/**
 * Model offset for a rendered offset: subtract the index of the paragraph the
 * offset falls in (each earlier paragraph added one '\n'). `renderedStarts` must
 * be ascending (as produced by `renderedParagraphStarts`).
 */
export function modelOffsetForRendered(renderedStarts: number[], rendered: number): number {
  let paragraph = 0;
  for (let i = 0; i < renderedStarts.length; i++) {
    if (renderedStarts[i]! <= rendered) paragraph = i;
    else break;
  }
  return rendered - paragraph;
}

/** Rendered offset for a model offset — the inverse of the above. */
export function renderedOffsetForModel(modelStarts: number[], model: number): number {
  let paragraph = 0;
  for (let i = 0; i < modelStarts.length; i++) {
    if (modelStarts[i]! <= model) paragraph = i;
    else break;
  }
  return model + paragraph;
}

export interface PageMetrics {
  /** Total rendered characters (body plus the extra '\n' per paragraph gap). */
  renderedTotal: number;
  /** Measured height of the whole chapter, px. */
  contentHeight: number;
  /** Height of one page, px. */
  pageStep: number;
  totalPages: number;
}

/**
 * Where a character sits, and what's at the top of a page.
 *
 * The chapter body is a single `UITextView`, so there's no per-character
 * geometry to ask: position is estimated from a character's share of the
 * rendered text. That's an approximation — a page of dialogue and a page of
 * prose hold different numbers of characters — but it's the same estimate the
 * read-along already uses to follow the spoken sentence, it degrades gracefully
 * (you land on the right page, or a neighbour), and it beats the alternative of
 * always reopening a book at page one.
 */
export function pageForRenderedOffset(rendered: number, metrics: PageMetrics): number {
  const { renderedTotal, contentHeight, pageStep, totalPages } = metrics;
  if (pageStep <= 0 || contentHeight <= 0) return 0;
  const y = (Math.max(0, rendered) / Math.max(1, renderedTotal)) * contentHeight;
  return Math.max(0, Math.min(totalPages - 1, Math.floor(y / pageStep)));
}

/** The rendered offset at the top of `page` — what the reader is now reading. */
export function renderedOffsetAtPage(page: number, metrics: PageMetrics): number {
  const { renderedTotal, contentHeight, pageStep } = metrics;
  if (contentHeight <= 0) return 0;
  const share = (Math.max(0, page) * pageStep) / contentHeight;
  return Math.max(0, Math.min(renderedTotal, Math.round(share * renderedTotal)));
}
