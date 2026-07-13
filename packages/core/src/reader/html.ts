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
          const rgb = HIGHLIGHT_COLORS[seg.annotation.color] ?? HIGHLIGHT_COLORS['yellow']!;
          const noteBadge = seg.annotation.note ? ' hl-note' : '';
          return `<span class="hl${noteBadge}" data-hl="${seg.annotation.id}" style="background: rgba(${rgb}, ${theme.hlAlpha})">${escapeHtml(seg.text)}</span>`;
        })
        .join('');
      const html = `<p data-po="${offset}">${segments}</p>`;
      offset += text.length + 1;
      return html;
    })
    .join('\n');

  const colorCss = Object.entries(HIGHLIGHT_COLORS)
    .map(([name, rgb]) => `.sel-${name} { background: rgba(${rgb}, ${theme.hlAlpha}); }`)
    .join('\n');

  const paged = settings.pagination === 'paged';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>
  html { -webkit-text-size-adjust: 100%; }
  body {
    background: ${theme.bg};
    color: ${theme.fg};
    font-family: Georgia, 'Iowan Old Style', serif;
    font-size: ${settings.fontSize}px;
    line-height: 1.65;
    margin: 0;
    padding: ${paged ? '0' : '18px 20px 120px'};
    -webkit-tap-highlight-color: transparent;
    ${paged ? 'overflow: hidden; height: 100vh;' : ''}
  }
  ${
    paged
      ? `#content {
    box-sizing: border-box;
    height: calc(100vh - 76px);
    margin: 44px 44px 32px;
    column-width: calc(100vw - 88px);
    column-gap: 88px;
    column-fill: auto;
    overflow: hidden;
  }`
      : ''
  }
  h1 { font-size: 1.45em; line-height: 1.25; margin: 0.5em 0 1em; }
  p { margin: 0 0 0.85em; text-align: justify; -webkit-hyphens: auto; hyphens: auto; }
  ::selection { background: rgba(${HIGHLIGHT_COLORS['yellow']}, 0.5); }
  .hl { border-radius: 2px; }
  .hl-note { border-bottom: 2px solid ${theme.accent}; }
  .tts-mark { background: rgba(120, 170, 255, 0.35); border-radius: 2px; }
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

  document.addEventListener('selectionchange', function () {
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

  function turnPage(delta) {
    var target = content.scrollLeft + delta * pageWidth();
    if (target < -1) { post({ type: 'pageEdge', dir: 'prev' }); return; }
    if (target > content.scrollWidth - content.clientWidth + 1) {
      post({ type: 'pageEdge', dir: 'next' });
      return;
    }
    animateScrollTo(Math.round(target / pageWidth()) * pageWidth(), 180);
  }

  document.addEventListener('click', function (event) {
    var hl = event.target.closest ? event.target.closest('[data-hl]') : null;
    if (hl) { post({ type: 'tapHighlight', id: hl.getAttribute('data-hl') }); return; }
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    if (PAGED) {
      var x = event.clientX / window.innerWidth;
      if (x < 0.18) { turnPage(-1); return; }
      if (x > 0.82) { turnPage(1); return; }
    }
    post({ type: 'tap' });
  });

  if (PAGED) {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); turnPage(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); turnPage(-1); }
    });
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
  };

  post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
