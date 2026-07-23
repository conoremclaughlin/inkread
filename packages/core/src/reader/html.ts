import type { Annotation, Chapter } from '../models/types';

/**
 * Chapter → self-contained reader HTML.
 *
 * Offsets: the chapter's "plain text" is `paragraphs.join('\n')`. Every
 * paragraph element carries data-po (its start offset). Highlights are
 * rendered at generation time by splitting paragraph text at annotation
 * boundaries — no fragile client-side range surgery.
 *
 * Page → RN messages: ready | selection {start,end,text} | scroll {offset}
 *   | tapHighlight {id}
 * RN → page calls:    __reader.scrollToOffset(n) | __reader.markSentence(s,e)
 *   | __reader.clearSentence()
 */

/**
 * Reading color schemes, tuned for long-form readability: warm off-whites
 * over pure white to cut glare, ink colors at ~12:1 contrast rather than
 * pure black, and desaturated light text on near-black for dark modes to
 * avoid halation. 'light'/'dark' are aliases kept for older callers.
 */
export type ReaderTheme =
  | 'paper'
  | 'sepia'
  | 'calm'
  | 'quiet'
  | 'night'
  | 'midnight'
  | 'light'
  | 'dark';

export interface ReaderSettings {
  theme: ReaderTheme;
  /** Base font size in px. */
  fontSize: number;
  /** 'scroll' (default): vertical chapter scroll. 'paged': page-flip via columns. */
  pagination?: 'scroll' | 'paged';
}

export interface ReaderThemeColors {
  bg: string;
  fg: string;
  accent: string;
  hlAlpha: string;
}

export const READER_THEMES: Record<ReaderTheme, ReaderThemeColors> = {
  /** The inkread house palette — warm cream, matches the app chrome. */
  paper: { bg: '#faf7f2', fg: '#26221c', accent: '#8b5e3c', hlAlpha: '0.38' },
  /** Classic tanned-paper reading mode. */
  sepia: { bg: '#f5ecd9', fg: '#3a3226', accent: '#8b5e3c', hlAlpha: '0.4' },
  /** Soft sage — low-glare green tint, easy on tired eyes. */
  calm: { bg: '#edeee4', fg: '#333a2f', accent: '#5f7c4a', hlAlpha: '0.4' },
  /** Neutral light gray, for those who find warm tints muddy. */
  quiet: { bg: '#ececee', fg: '#2c2c31', accent: '#4a6d7c', hlAlpha: '0.38' },
  /** Near-black with desaturated ivory text — reading in the dark. */
  night: { bg: '#121212', fg: '#d8d4cd', accent: '#c9a227', hlAlpha: '0.45' },
  /** Deep blue-black — dark without the void. */
  midnight: { bg: '#12161f', fg: '#c9d0dc', accent: '#7d9cc0', hlAlpha: '0.45' },
  // Aliases for callers predating the expanded set.
  light: { bg: '#ffffff', fg: '#1a1a1a', accent: '#8b5e3c', hlAlpha: '0.35' },
  dark: { bg: '#121212', fg: '#d8d4cd', accent: '#c9a227', hlAlpha: '0.45' },
};

const THEMES = READER_THEMES;

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '255, 210, 60',
  green: '110, 200, 120',
  blue: '100, 170, 240',
  pink: '240, 130, 170',
  purple: '175, 130, 230',
};

/** Themes whose page is dark enough that the reader's text is the light layer. */
function isDarkTheme(theme: ReaderTheme): boolean {
  return theme === 'night' || theme === 'midnight' || theme === 'dark';
}

/**
 * The rgb triple to fill a highlight of `color` under `theme`. The palette is
 * tuned for dark text on a light page; on dark themes those bright, saturated
 * fills sit at nearly the same lightness as the ivory body text, so a highlight
 * washes the words out. For dark themes we pull each colour toward gray
 * (desaturate) and darken it, so the fill drops below the text in lightness —
 * the words read clearly on top while the hue is still recognisable.
 */
function highlightRgb(color: string, theme: ReaderTheme): string {
  const raw = HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS['yellow']!;
  if (!isDarkTheme(theme)) return raw;
  const [r, g, b] = raw.split(',').map((n) => parseInt(n.trim(), 10)) as [number, number, number];
  const gray = (r + g + b) / 3;
  const DESATURATE = 0.6; // keep 60% of the hue, 40% pulled toward gray
  const DARKEN = 0.62; // then scale brightness down
  const adjust = (c: number) => Math.round((c * DESATURATE + gray * (1 - DESATURATE)) * DARKEN);
  return `${adjust(r)}, ${adjust(g)}, ${adjust(b)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Segment {
  text: string;
  annotation?: Annotation;
}

/** Split one paragraph's text into plain/highlighted segments. */
function segmentParagraph(
  text: string,
  paragraphStart: number,
  annotations: Annotation[],
): Segment[] {
  const paragraphEnd = paragraphStart + text.length;
  const overlapping = annotations
    .filter((a) => a.locator.start < paragraphEnd && a.locator.end > paragraphStart)
    .sort((a, b) => a.locator.start - b.locator.start);
  if (overlapping.length === 0) return [{ text }];

  const segments: Segment[] = [];
  let cursor = 0;
  for (const annotation of overlapping) {
    const start = Math.max(0, annotation.locator.start - paragraphStart);
    const end = Math.min(text.length, annotation.locator.end - paragraphStart);
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    if (end > Math.max(start, cursor)) {
      segments.push({ text: text.slice(Math.max(start, cursor), end), annotation });
      cursor = end;
    }
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

export function buildReaderHtml(
  chapter: Chapter,
  annotations: Annotation[],
  settings: ReaderSettings,
): string {
  const theme = THEMES[settings.theme];
  let offset = 0;
  const paragraphsHtml = chapter.paragraphs
    .map((text) => {
      const segments = segmentParagraph(text, offset, annotations)
        .map((seg) => {
          if (!seg.annotation) return escapeHtml(seg.text);
          const rgb = highlightRgb(seg.annotation.color, settings.theme);
          const noteBadge = seg.annotation.note ? ' hl-note' : '';
          return `<span class="hl${noteBadge}" data-hl="${seg.annotation.id}" style="background: rgba(${rgb}, ${theme.hlAlpha})">${escapeHtml(seg.text)}</span>`;
        })
        .join('');
      const html = `<p data-po="${offset}">${segments}</p>`;
      offset += text.length + 1;
      return html;
    })
    .join('\n');

  const colorCss = Object.keys(HIGHLIGHT_COLORS)
    .map(
      (name) =>
        `.sel-${name} { background: rgba(${highlightRgb(name, settings.theme)}, ${theme.hlAlpha}); }`,
    )
    .join('\n');

  const paged = settings.pagination === 'paged';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<style>
  html { -webkit-text-size-adjust: 100%; overscroll-behavior-x: none; }
  body {
    background: ${theme.bg};
    color: ${theme.fg};
    font-family: Georgia, 'Iowan Old Style', serif;
    font-size: ${settings.fontSize}px;
    line-height: 1.65;
    margin: 0;
    padding: ${paged ? '0' : '16px 20px calc(44px + env(safe-area-inset-bottom, 0px))'};
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior-x: none;
    ${paged ? 'overflow: hidden; height: 100vh;' : ''}
  }
  ${
    paged
      ? `#content {
    box-sizing: border-box;
    height: calc(100vh - 44px - env(safe-area-inset-bottom, 0px));
    margin: 20px 44px calc(24px + env(safe-area-inset-bottom, 0px));
    column-width: calc(100vw - 88px);
    column-gap: 88px;
    column-fill: auto;
    overflow: hidden;
  }`
      : ''
  }
  h1 { font-size: 1.45em; line-height: 1.25; margin: 0.5em 0 1em; }
  p { margin: 0 0 0.85em; text-align: justify; -webkit-hyphens: auto; hyphens: auto; }
  ::selection { background: rgba(${highlightRgb('yellow', settings.theme)}, 0.5); }
  .hl { border-radius: 2px; }
  .hl-note { border-bottom: 2px solid ${theme.accent}; }
  .tts-mark { background: rgba(120, 170, 255, 0.35); border-radius: 2px; }
  ::highlight(inkread-extend) { background-color: color-mix(in srgb, ${theme.accent} 34%, transparent); }
  ${colorCss}
</style>
</head>
<body${paged ? ' class="paged"' : ''}>
<div id="content">
<h1>${escapeHtml(chapter.title)}</h1>
${paragraphsHtml}
</div>
<script>
(function () {
  // Host bridge: React Native WebView on mobile, parent iframe on web.
  var post = function (msg) {
    var json = JSON.stringify(msg);
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(json);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: 'inkread-reader', payload: json }, '*');
    }
  };

  function paragraphOf(node) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el && !(el.tagName === 'P' && el.hasAttribute('data-po'))) el = el.parentElement;
    return el;
  }

  function offsetIn(p, node, nodeOffset) {
    var range = document.createRange();
    range.setStart(p, 0);
    range.setEnd(node, nodeOffset);
    return parseInt(p.getAttribute('data-po'), 10) + range.toString().length;
  }

  // --- Cross-page selection: pick a start, flip pages, click the end. ---
  var extending = false;
  var anchorOffset = 0;

  function pointToOffset(x, y) {
    var node, off;
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer; off = r.startOffset;
    } else if (document.caretPositionFromPoint) {
      var cp = document.caretPositionFromPoint(x, y);
      if (!cp) return null;
      node = cp.offsetNode; off = cp.offset;
    } else { return null; }
    if (node.nodeType === 3) {
      var t = node.textContent;
      while (off < t.length && t[off].trim() !== '') off++; // snap to the end of the tapped word
    }
    var p = paragraphOf(node);
    if (!p) return null;
    return offsetIn(p, node, off);
  }

  // Paint the pending range with the Custom Highlight API — it spans column
  // pages without touching the DOM. Returns the range's text (for the note).
  function extendPreview(a, b) {
    var lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi <= lo) { if (window.CSS && CSS.highlights) CSS.highlights.delete('inkread-extend'); return ''; }
    var from = resolveOffset(lo), to = resolveOffset(hi);
    if (!from || !to) return '';
    try {
      var range = document.createRange();
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      if (window.CSS && CSS.highlights && typeof Highlight !== 'undefined') {
        CSS.highlights.set('inkread-extend', new Highlight(range));
      }
      return range.toString();
    } catch (e) { return ''; }
  }

  document.addEventListener('selectionchange', function () {
    if (extending) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { post({ type: 'selection', clear: true }); return; }
    var range = sel.getRangeAt(0);
    var p1 = paragraphOf(range.startContainer);
    var p2 = paragraphOf(range.endContainer);
    if (!p1 || !p2) return;
    var start = offsetIn(p1, range.startContainer, range.startOffset);
    var end = offsetIn(p2, range.endContainer, range.endOffset);
    // Selections spanning paragraphs include the joining '\\n' per paragraph gap.
    var text = range.toString();
    if (end > start && text.trim().length > 0) {
      post({ type: 'selection', start: start, end: end, text: text });
    }
  });

  var PAGED = ${paged ? 'true' : 'false'};
  var content = document.getElementById('content');

  function pageWidth() { return content.clientWidth + 88; }

  function reportPosition() {
    var paragraphs = document.querySelectorAll('p[data-po]');
    for (var i = 0; i < paragraphs.length; i++) {
      var rect = paragraphs[i].getBoundingClientRect();
      var visible = PAGED
        ? rect.right > 44 && rect.left < window.innerWidth
        : rect.bottom > 10;
      if (visible) {
        post({ type: 'scroll', offset: parseInt(paragraphs[i].getAttribute('data-po'), 10) });
        return;
      }
    }
  }

  // Kobo-quick page turns: native smooth scrolling is ~400ms and not
  // tunable, so animate scrollLeft ourselves with a short ease-out.
  var turnAnimation = null;
  function animateScrollTo(left, duration) {
    if (turnAnimation) cancelAnimationFrame(turnAnimation);
    var from = content.scrollLeft;
    var change = left - from;
    if (change === 0) return;
    var start = null;
    function step(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      content.scrollLeft = from + change * eased;
      if (t < 1) turnAnimation = requestAnimationFrame(step);
      else { turnAnimation = null; reportPosition(); }
    }
    turnAnimation = requestAnimationFrame(step);
  }

  function maxScroll() { return content.scrollWidth - content.clientWidth; }
  function pageAt(scroll) { return Math.round(scroll / pageWidth()) * pageWidth(); }

  // Settle onto a page delta away from baseScroll (the position the drag
  // started from), or flow into the neighbor chapter at a boundary. Used by
  // the release of a finger-drag and by the edge taps / keys.
  function settlePage(delta, baseScroll) {
    var base = pageAt(baseScroll == null ? content.scrollLeft : baseScroll);
    var target = base + delta * pageWidth();
    if (target < -1) { animateScrollTo(base, 160); post({ type: 'pageEdge', dir: 'prev' }); return; }
    if (target > maxScroll() + 1) { animateScrollTo(base, 160); post({ type: 'pageEdge', dir: 'next' }); return; }
    animateScrollTo(target, 190);
  }

  function turnPage(delta) { settlePage(delta, content.scrollLeft); }

  document.addEventListener('click', function (event) {
    if (justDragged) return;
    var hl = event.target.closest ? event.target.closest('[data-hl]') : null;
    if (hl) { post({ type: 'tapHighlight', id: hl.getAttribute('data-hl') }); return; }
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (extending) {
      // Edge taps still turn pages so you can navigate to the end point.
      if (PAGED) {
        var ex = event.clientX / window.innerWidth;
        if (ex < 0.18) { turnPage(-1); return; }
        if (ex > 0.82) { turnPage(1); return; }
      }
      var eoff = pointToOffset(event.clientX, event.clientY);
      if (eoff != null && eoff !== anchorOffset) {
        var lo = Math.min(anchorOffset, eoff), hi = Math.max(anchorOffset, eoff);
        var text = extendPreview(anchorOffset, eoff);
        post({ type: 'extendPoint', start: lo, end: hi, text: text });
      }
      return;
    }
    if (PAGED) {
      var x = event.clientX / window.innerWidth;
      if (x < 0.18) { turnPage(-1); return; }
      if (x > 0.82) { turnPage(1); return; }
    }
    post({ type: 'tap' });
  });

  // Finger-tracking page drag (paged mode): scrollLeft follows your thumb so
  // the neighbor page slides in from the screen edge live, then completes or
  // springs back on release — far more native than the old jump-on-swipe. A
  // tap (no movement) falls through to the click handler for chrome / edges.
  var swipeX = 0, swipeY = 0, swipeT = 0;
  var dragging = false, dragDecided = false, dragHoriz = false;
  var dragBase = 0, dragDX = 0, justDragged = false;

  document.addEventListener('touchstart', function (event) {
    if (event.touches.length !== 1) return;
    swipeX = event.touches[0].clientX;
    swipeY = event.touches[0].clientY;
    swipeT = event.timeStamp;
    dragging = false; dragDecided = false; dragHoriz = false; dragDX = 0;
    if (PAGED) { if (turnAnimation) { cancelAnimationFrame(turnAnimation); turnAnimation = null; } dragBase = content.scrollLeft; }
  }, { passive: true });

  document.addEventListener('touchmove', function (event) {
    if (!PAGED || extending || event.touches.length !== 1) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // let text selection win
    var dx = event.touches[0].clientX - swipeX;
    var dy = event.touches[0].clientY - swipeY;
    if (!dragDecided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      dragDecided = true;
      dragHoriz = Math.abs(dx) > Math.abs(dy) * 1.2;
    }
    if (!dragHoriz) return;
    dragging = true;
    dragDX = dx;
    // Drag left (dx<0) pulls the next page in; scrollLeft clamps at the ends.
    content.scrollLeft = Math.max(0, Math.min(maxScroll(), dragBase - dx));
    event.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', function (event) {
    if (!PAGED || !dragging) return;
    dragging = false;
    justDragged = true;
    setTimeout(function () { justDragged = false; }, 350);
    var elapsed = event.timeStamp - swipeT;
    var flick = Math.abs(dragDX) > 40 && elapsed < 250;
    if (Math.abs(dragDX) > pageWidth() * 0.22 || flick) settlePage(dragDX < 0 ? 1 : -1, dragBase);
    else settlePage(0, dragBase);
  }, { passive: true });

  // The extend end is set by a click (see the click handler), not by cursor
  // movement: a live follow meant that reaching for the confirm bar dragged the
  // highlight down across the page. Click a word to set the end, click another
  // to adjust, then pick a colour.

  if (PAGED) {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); turnPage(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); turnPage(-1); }
    });
    // Trackpad horizontal swipe → page turn. preventDefault is the point: it
    // stops the browser treating the swipe as a back/forward navigation (which
    // used to yank the reader off-screen instead of turning the page). One turn
    // per gesture via a short lock; vertical intent falls through to scrolling.
    var wheelAccum = 0, wheelLock = false, wheelReset = null;
    document.addEventListener('wheel', function (event) {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (wheelLock) return;
      wheelAccum += event.deltaX;
      if (wheelReset) clearTimeout(wheelReset);
      wheelReset = setTimeout(function () { wheelAccum = 0; }, 200);
      if (Math.abs(wheelAccum) > 60) {
        wheelLock = true;
        turnPage(wheelAccum > 0 ? 1 : -1);
        wheelAccum = 0;
        setTimeout(function () { wheelLock = false; }, 450);
      }
    }, { passive: false });
    // Snap back to a page boundary when the window resizes.
    window.addEventListener('resize', function () {
      content.scrollTo({ left: Math.round(content.scrollLeft / pageWidth()) * pageWidth() });
    });
  } else {
    var scrollTimer = null;
    window.addEventListener('scroll', function () {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(reportPosition, 250);
    });
  }

  function resolveOffset(target) {
    var paragraphs = document.querySelectorAll('p[data-po]');
    var best = null;
    for (var i = 0; i < paragraphs.length; i++) {
      var po = parseInt(paragraphs[i].getAttribute('data-po'), 10);
      if (po <= target) best = paragraphs[i]; else break;
    }
    if (!best) return null;
    var walker = document.createTreeWalker(best, NodeFilter.SHOW_TEXT);
    var remaining = target - parseInt(best.getAttribute('data-po'), 10);
    var node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.textContent.length) return { node: node, offset: remaining };
      remaining -= node.textContent.length;
    }
    return { node: best, offset: 0, element: true };
  }

  function bringIntoView(el, smooth) {
    if (!el) return;
    if (PAGED) {
      var left = content.scrollLeft + el.getBoundingClientRect().left - 44;
      var page = Math.max(0, Math.floor(left / pageWidth()) * pageWidth());
      if (smooth) animateScrollTo(page, 180);
      else { content.scrollLeft = page; reportPosition(); }
    } else {
      el.scrollIntoView({ block: smooth ? 'center' : 'start', behavior: smooth ? 'smooth' : 'auto' });
      if (!smooth) window.scrollBy(0, -8);
    }
  }

  window.__reader = {
    scrollToOffset: function (target) {
      var pos = resolveOffset(target);
      if (!pos) return;
      bringIntoView(pos.element ? pos.node : pos.node.parentElement, false);
    },
    turnPage: function (delta) { if (PAGED) turnPage(delta); },
    markSentence: function (start, end) {
      this.clearSentence();
      var from = resolveOffset(start);
      var to = resolveOffset(end);
      if (!from || !to || from.element || to.element) return;
      try {
        var range = document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        var mark = document.createElement('span');
        mark.className = 'tts-mark';
        range.surroundContents(mark);
        bringIntoView(mark, true);
      } catch (e) { /* range crosses element boundaries; skip visual mark */ }
    },
    clearSentence: function () {
      document.querySelectorAll('.tts-mark').forEach(function (mark) {
        var parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      });
    },
    beginExtend: function (start, end) {
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      extending = true;
      anchorOffset = start;
      extendPreview(start, end); // keep the original selection visible as the range grows
    },
    endExtend: function () {
      extending = false;
      if (window.CSS && CSS.highlights) CSS.highlights.delete('inkread-extend');
    },
  };

  post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
