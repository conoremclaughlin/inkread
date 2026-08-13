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
