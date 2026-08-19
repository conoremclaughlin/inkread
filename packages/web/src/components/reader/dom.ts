/**
 * DOM ↔ character-offset mapping for the native web reader.
 *
 * The offset model matches core: a chapter's plain text is
 * `paragraphs.join('\n')`, and every rendered <p> carries `data-po` — the
 * chapter offset where its paragraph starts. These are typed, unit-tested
 * ports of logic the embedded reader document (buildReaderHtml's inline
 * <script>) carries as an untyped string. The native React renderer imports
 * them directly; the embedded copy retires with the iframe.
 *
 * Everything here is client-only — the functions touch live DOM nodes and are
 * never called during SSR.
 */

/** The enclosing `<p data-po>` of a DOM node, or null when outside one. */
export function paragraphOf(node: Node): HTMLElement | null {
  let el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  while (el && !(el.tagName === 'P' && el.hasAttribute('data-po'))) el = el.parentElement;
  return el;
}

/** Chapter offset of a (node, offsetInNode) DOM position inside paragraph `p`. */
export function offsetWithin(p: HTMLElement, node: Node, offsetInNode: number): number {
  const range = p.ownerDocument.createRange();
  range.setStart(p, 0);
  range.setEnd(node, offsetInNode);
  return parseInt(p.getAttribute('data-po') ?? '0', 10) + range.toString().length;
}

/**
 * Chapter offsets + text of a DOM Range (e.g. the live selection). Null when
 * either endpoint sits outside a `data-po` paragraph (chrome, gaps).
 *
 * Note: offsets are computed from the paragraph anchors, so a cross-paragraph
 * range correctly counts the joining '\n' even though `Range.toString()`
 * (the returned `text`) concatenates without it.
 */
export function rangeOffsets(
  range: Range,
): { start: number; end: number; text: string } | null {
  const p1 = paragraphOf(range.startContainer);
  const p2 = paragraphOf(range.endContainer);
  if (!p1 || !p2) return null;
  return {
    start: offsetWithin(p1, range.startContainer, range.startOffset),
    end: offsetWithin(p2, range.endContainer, range.endOffset),
    text: range.toString(),
  };
}

/**
 * Nudge a caret position to the end of the word it landed in.
 *
 * Tapping to set a highlight's end point should include the whole word — a
 * caret two characters into "principles" means "…principles", not "…pri".
 */
export function snapToWordEnd(text: string, offset: number): number {
  let end = Math.max(0, Math.min(text.length, offset));
  while (end < text.length && text[end]!.trim() !== '') end += 1;
  return end;
}

/**
 * The chapter offset under a viewport point (used to set the end of a
 * cross-page highlight). Null outside the chapter text, or where the browser
 * exposes no caret API.
 */
export function offsetAtPoint(root: ParentNode, x: number, y: number): number | null {
  const doc = (root as Element).ownerDocument ?? document;
  let node: Node | null = null;
  let offset = 0;
  const withCaretRange = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (withCaretRange.caretRangeFromPoint) {
    const range = withCaretRange.caretRangeFromPoint(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  } else if (withCaretRange.caretPositionFromPoint) {
    const position = withCaretRange.caretPositionFromPoint(x, y);
    if (!position) return null;
    node = position.offsetNode;
    offset = position.offset;
  } else {
    return null;
  }
  if (node.nodeType === 3) offset = snapToWordEnd(node.textContent ?? '', offset);
  const paragraph = paragraphOf(node);
  if (!paragraph || !root.contains(paragraph)) return null;
  return offsetWithin(paragraph, node, offset);
}

/** A paragraph's chapter offset plus where it currently sits on screen. */
export interface ParagraphBox {
  offset: number;
  rect: { top: number; bottom: number; left: number; right: number };
}

/**
 * The reading position: the offset of the first paragraph still on screen.
 *
 * Scroll mode reads top-down (a paragraph counts once its bottom edge clears
 * the top of the viewport); paged mode reads left-to-right (a paragraph counts
 * once its right edge clears the left margin and it hasn't yet passed the
 * right edge). Both leave a small slack so a paragraph only just leaving the
 * view doesn't claim the position. Returns null when nothing is visible —
 * mid-turn, or before layout — and the caller keeps its previous position.
 */
export function visibleOffset(
  boxes: ParagraphBox[],
  bounds: { top: number; left: number; right: number },
  mode: 'scroll' | 'paged',
): number | null {
  for (const box of boxes) {
    const visible =
      mode === 'paged'
        ? box.rect.right > bounds.left + 44 && box.rect.left < bounds.right
        : box.rect.bottom > bounds.top + 10;
    if (visible) return box.offset;
  }
  return null;
}

/** Read every rendered paragraph's offset and on-screen box, in document order. */
export function paragraphBoxes(root: ParentNode): ParagraphBox[] {
  return Array.from(root.querySelectorAll('p[data-po]')).map((p) => ({
    offset: parseInt(p.getAttribute('data-po') ?? '0', 10),
    rect: p.getBoundingClientRect(),
  }));
}

export interface ResolvedOffset {
  node: Node;
  offset: number;
  /** True when the target lies past the paragraph's text and `node` is the <p> itself. */
  element?: boolean;
}

/**
 * Locate a chapter offset as a (text node, offset-in-node) position under
 * `root` — the inverse of `offsetWithin`, used to scroll to a saved position,
 * paint a TTS sentence mark, or anchor an extend-selection preview.
 */
export function resolveOffset(root: ParentNode, target: number): ResolvedOffset | null {
  const paragraphs = root.querySelectorAll('p[data-po]');
  let best: HTMLElement | null = null;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i] as HTMLElement;
    if (parseInt(p.getAttribute('data-po') ?? '0', 10) <= target) best = p;
    else break;
  }
  if (!best) return null;
  const walker = best.ownerDocument.createTreeWalker(best, NodeFilter.SHOW_TEXT);
  let remaining = target - parseInt(best.getAttribute('data-po') ?? '0', 10);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }
  return { node: best, offset: 0, element: true };
}
