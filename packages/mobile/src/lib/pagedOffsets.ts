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
