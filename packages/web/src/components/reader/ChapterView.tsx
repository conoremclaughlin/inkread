'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  applyMark,
  highlightRgb,
  READER_THEMES,
  segmentChapterRuns,
  type Annotation,
  type MarkedRun,
  type ReaderTheme,
} from '@inkread/core';
import {
  offsetAtPoint,
  paragraphBoxes,
  paragraphOf,
  rangeOffsets,
  resolveOffset,
  visibleOffset,
} from './dom';
import {
  clampX,
  COLUMN_GAP,
  dragAxis,
  dragTurn,
  pageAt,
  pageWidth,
  rubberBand,
  settle,
  tapZone,
} from './pager';

/**
 * The reader's page — rendered as real DOM in the host document.
 *
 * This replaces the `buildReaderHtml` iframe on web: same offset model (chapter
 * text is `paragraphs.join('\n')`, every <p> carries data-po), same shared
 * segmentation from `@inkread/core`, but the paragraphs are React elements, so
 * highlights and the TTS read-along mark are ordinary renders instead of DOM
 * surgery, and the host talks to the view by ref instead of postMessage.
 *
 * The imperative surface is deliberately identical to the old `window.__reader`
 * bridge, so the reader chrome above it did not have to change.
 */

export interface ReaderHandle {
  /** Bring a chapter offset into view (restoring a saved reading position). */
  scrollToOffset: (offset: number) => void;
  /** Turn `delta` pages; no-op in scroll mode. */
  turnPage: (delta: number) => void;
  /** Tint the sentence being spoken and follow it. */
  markSentence: (start: number, end: number) => void;
  clearSentence: () => void;
  /** Start a cross-page highlight anchored at [start,end). */
  beginExtend: (start: number, end: number) => void;
  endExtend: () => void;
}

export interface TextRange {
  start: number;
  end: number;
  text: string;
}

export interface ChapterViewProps {
  title: string;
  paragraphs: string[];
  annotations: Annotation[];
  theme: ReaderTheme;
  fontSize: number;
  pagination: 'scroll' | 'paged';
  /** Fired once the chapter is laid out and ready to be positioned. */
  onReady?: () => void;
  /** Live selection, or undefined when it collapses. */
  onSelection?: (selection: TextRange | undefined) => void;
  /** During extend: the tapped end point, as a range from the anchor. */
  onExtendPoint?: (range: TextRange) => void;
  /** Reading position moved (scroll settled, or a page turn finished). */
  onPosition?: (offset: number) => void;
  onTapHighlight?: (id: string) => void;
  /** A page turn ran off this chapter — the host flows to the neighbour. */
  onPageEdge?: (direction: 'prev' | 'next') => void;
  /** A plain tap on the page (dismisses the chrome). */
  onTap?: () => void;
}

const TURN_MS = 240;
const EDGE_MS = 200;
/** Space above/below the page in paged mode (matches the old iframe layout). */
const PAGE_INSET = 44;
const EXTEND_HIGHLIGHT = 'inkread-extend';

/** Theme-dependent rules; scoped to this reader so page chrome is unaffected. */
function readerCss(theme: ReaderTheme, fontSize: number): string {
  const colors = READER_THEMES[theme];
  return `
.inkread-reader { color: ${colors.fg}; font-family: Georgia, 'Iowan Old Style', serif; font-size: ${fontSize}px; line-height: 1.65; }
.inkread-reader h1 { font-size: 1.45em; line-height: 1.25; margin: 0.5em 0 1em; }
.inkread-reader p { margin: 0 0 0.85em; text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
.inkread-reader ::selection { background: rgba(${highlightRgb('yellow', theme)}, 0.5); }
.inkread-reader .hl { border-radius: 2px; }
.inkread-reader .hl-note { border-bottom: 2px solid ${colors.accent}; }
.inkread-reader .tts-mark { background: rgba(120, 170, 255, 0.35); border-radius: 2px; }
::highlight(${EXTEND_HIGHLIGHT}) { background-color: color-mix(in srgb, ${colors.accent} 34%, transparent); }
`;
}

/** One run → text, a highlight span, the read-along tint, or both nested. */
function renderRun(run: MarkedRun, key: number, theme: ReaderTheme, alpha: string) {
  const inner = run.marked ? (
    <span className="tts-mark">{run.text}</span>
  ) : (
    run.text
  );
  if (!run.annotation) return run.marked ? <span key={key}>{inner}</span> : run.text;
  return (
    <span
      key={key}
      className={`hl${run.annotation.note ? ' hl-note' : ''}`}
      data-hl={run.annotation.id}
      style={{ background: `rgba(${highlightRgb(run.annotation.color, theme)}, ${alpha})` }}
    >
      {inner}
    </span>
  );
}

export const ChapterView = forwardRef<ReaderHandle, ChapterViewProps>(function ChapterView(
  props,
  ref,
) {
  const { title, paragraphs, annotations, theme, fontSize, pagination } = props;
  const paged = pagination === 'paged';

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Newest callbacks, readable from native listeners that are bound once.
  const propsRef = useRef(props);
  propsRef.current = props;

  const [mark, setMark] = useState<{ start: number; end: number }>();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const viewXRef = useRef(0);
  const maxXRef = useRef(0);
  const extendingRef = useRef(false);
  const anchorRef = useRef(0);
  const justDraggedRef = useRef(false);

  const colors = READER_THEMES[theme];
  const segments = useMemo(
    () => segmentChapterRuns(paragraphs, annotations),
    [paragraphs, annotations],
  );

  // Paged geometry: the page is the viewport minus its margins; columns are
  // exactly one page wide so a turn moves by one column plus its gutter.
  const contentWidth = Math.max(1, size.width - COLUMN_GAP);
  const step = pageWidth(contentWidth);

  const applyTransform = useCallback((x: number, ms: number) => {
    const content = contentRef.current;
    if (!content) return;
    if (ms) {
      content.style.transition = `transform ${ms}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
      void content.offsetWidth; // flush, so the transition starts from here
    } else {
      content.style.transition = 'none';
    }
    content.style.transform = `translate3d(${-x}px, 0, 0)`;
  }, []);

  const setViewX = useCallback(
    (x: number, ms: number) => {
      viewXRef.current = clampX(x, maxXRef.current);
      applyTransform(viewXRef.current, ms);
    },
    [applyTransform],
  );

  /** The live position mid-transition, read back off the compositor. */
  const readViewX = useCallback((): number => {
    const content = contentRef.current;
    if (!content || typeof getComputedStyle !== 'function') return viewXRef.current;
    const transform = getComputedStyle(content).transform;
    if (!transform || transform === 'none') return viewXRef.current;
    try {
      return -new DOMMatrixReadOnly(transform).m41;
    } catch {
      return viewXRef.current;
    }
  }, []);

  const report = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const bounds = viewport.getBoundingClientRect();
    const offset = visibleOffset(
      paragraphBoxes(content),
      { top: bounds.top, left: bounds.left, right: bounds.right },
      paged ? 'paged' : 'scroll',
    );
    if (offset !== null) propsRef.current.onPosition?.(offset);
  }, [paged]);

  // #content is overflow:visible so columns can slide past the page edge, but
  // scrollWidth only means something on a scroll container — clip for the
  // measurement, then cache the extent.
  const measure = useCallback(() => {
    const content = contentRef.current;
    if (!content || !paged) {
      maxXRef.current = 0;
      return;
    }
    content.style.overflow = 'hidden';
    maxXRef.current = Math.max(0, content.scrollWidth - content.clientWidth);
    content.style.overflow = '';
  }, [paged]);

  const settleTo = useCallback(
    (delta: number, baseX?: number) => {
      const result = settle(baseX ?? viewXRef.current, delta, step, maxXRef.current);
      setViewX(result.x, result.edge ? EDGE_MS : TURN_MS);
      if (result.edge) propsRef.current.onPageEdge?.(result.edge);
    },
    [setViewX, step],
  );

  const bringIntoView = useCallback(
    (element: Element | null, smooth: boolean) => {
      if (!element) return;
      const viewport = viewportRef.current;
      if (paged) {
        if (!viewport) return;
        const left =
          readViewX() +
          element.getBoundingClientRect().left -
          viewport.getBoundingClientRect().left -
          PAGE_INSET;
        const page = Math.max(0, Math.floor(left / step) * step);
        if (smooth) setViewX(page, TURN_MS);
        else {
          setViewX(page, 0);
          report();
        }
      } else {
        element.scrollIntoView({
          block: smooth ? 'center' : 'start',
          behavior: smooth ? 'smooth' : 'auto',
        });
        if (!smooth && viewport) viewport.scrollTop = Math.max(0, viewport.scrollTop - 8);
      }
    },
    [paged, readViewX, report, setViewX, step],
  );

  /** Paint the pending extend range without touching the DOM (Highlight API). */
  const paintExtend = useCallback((from: number, to: number): string => {
    const content = contentRef.current;
    const highlights = typeof CSS !== 'undefined' ? CSS.highlights : undefined;
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    if (!content || high <= low) {
      highlights?.delete(EXTEND_HIGHLIGHT);
      return '';
    }
    const start = resolveOffset(content, low);
    const end = resolveOffset(content, high);
    if (!start || !end) return '';
    try {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      if (highlights && typeof Highlight !== 'undefined') {
        highlights.set(EXTEND_HIGHLIGHT, new Highlight(range));
      }
      return range.toString();
    } catch {
      return '';
    }
  }, []);

  useImperativeHandle(
    ref,
    (): ReaderHandle => ({
      scrollToOffset: (offset) => {
        const content = contentRef.current;
        if (!content) return;
        const position = resolveOffset(content, offset);
        if (!position) return;
        bringIntoView(
          position.element ? (position.node as Element) : position.node.parentElement,
          false,
        );
      },
      turnPage: (delta) => {
        if (paged) settleTo(delta);
      },
      markSentence: (start, end) => setMark({ start, end }),
      clearSentence: () => setMark(undefined),
      beginExtend: (start, end) => {
        window.getSelection()?.removeAllRanges();
        extendingRef.current = true;
        anchorRef.current = start;
        paintExtend(start, end); // keep the original selection visible
      },
      endExtend: () => {
        extendingRef.current = false;
        if (typeof CSS !== 'undefined') CSS.highlights?.delete(EXTEND_HIGHLIGHT);
      },
    }),
    [bringIntoView, paged, paintExtend, settleTo],
  );

  // Track the viewport so paged columns are exactly one page wide.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prior) =>
        prior.width === width && prior.height === height ? prior : { width, height },
      );
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // New chapter (or a relayout): re-measure, reset to page one, announce ready.
  useEffect(() => {
    setMark(undefined);
    viewXRef.current = 0;
    if (paged) {
      measure();
      applyTransform(0, 0);
    } else {
      applyTransform(0, 0);
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
    }
    propsRef.current.onReady?.();
  }, [applyTransform, measure, paged, segments, title, fontSize, size.width, size.height]);

  // Follow the spoken sentence.
  useEffect(() => {
    if (!mark) return;
    const element = contentRef.current?.querySelector('.tts-mark');
    if (element) bringIntoView(element, true);
  }, [bringIntoView, mark]);

  // A selection anywhere in the chapter becomes chapter offsets. Selections in
  // the surrounding chrome (menus, note editor) resolve to no paragraph and are
  // ignored, so the action bar only ever describes the page.
  useEffect(() => {
    const onSelectionChange = () => {
      if (extendingRef.current) return;
      const content = contentRef.current;
      const selection = window.getSelection();
      if (!content) return;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        propsRef.current.onSelection?.(undefined);
        return;
      }
      const range = selection.getRangeAt(0);
      const inside =
        content.contains(range.startContainer) && content.contains(range.endContainer);
      if (!inside || !paragraphOf(range.startContainer)) return;
      const offsets = rangeOffsets(range);
      if (!offsets || offsets.end <= offsets.start || offsets.text.trim().length === 0) return;
      propsRef.current.onSelection?.(offsets);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  // Scroll mode: report the reading position once scrolling settles.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || paged) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(report, 250);
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [paged, report]);

  // Paged mode: finger-drag, trackpad swipe, and the settle-driven report.
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || !paged) return;

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === 'transform') report();
    };
    content.addEventListener('transitionend', onTransitionEnd);

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let dragging = false;
    let axis: 'horizontal' | 'vertical' | null = null;
    let base = 0;
    let dx = 0;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = event.timeStamp;
      dragging = false;
      axis = null;
      dx = 0;
      viewXRef.current = readViewX();
      setViewX(viewXRef.current, 0);
      base = viewXRef.current;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (extendingRef.current || event.touches.length !== 1) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return; // let text selection win
      const touch = event.touches[0]!;
      dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!axis) axis = dragAxis(dx, dy);
      if (axis !== 'horizontal') return;
      dragging = true;
      const raw = base - dx;
      viewXRef.current = clampX(raw, maxXRef.current);
      applyTransform(rubberBand(raw, maxXRef.current), 0);
      event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 350);
      settleTo(dragTurn(dx, event.timeStamp - startTime, step), base);
    };

    // Trackpad horizontal swipe → one page per gesture. preventDefault is the
    // point: without it the browser treats the swipe as back/forward navigation.
    let accumulated = 0;
    let locked = false;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (locked) return;
      accumulated += event.deltaX;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        accumulated = 0;
      }, 200);
      if (Math.abs(accumulated) > 60) {
        locked = true;
        settleTo(accumulated > 0 ? 1 : -1);
        accumulated = 0;
        setTimeout(() => {
          locked = false;
        }, 450);
      }
    };

    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      content.removeEventListener('transitionend', onTransitionEnd);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('wheel', onWheel);
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [applyTransform, paged, readViewX, report, setViewX, settleTo, step]);

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (justDraggedRef.current) return;
      const target = event.target as HTMLElement;
      const highlight = target.closest?.('[data-hl]');
      if (highlight) {
        propsRef.current.onTapHighlight?.(highlight.getAttribute('data-hl') ?? '');
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      if (extendingRef.current) {
        // Every tap sets the highlight's end point. Page turns during extend go
        // through the host's explicit controls — overloading edge taps to also
        // turn pages meant a tap near the margin silently flipped the page.
        const content = contentRef.current;
        const end = content ? offsetAtPoint(content, event.clientX, event.clientY) : null;
        if (end !== null && end !== anchorRef.current) {
          const text = paintExtend(anchorRef.current, end);
          propsRef.current.onExtendPoint?.({
            start: Math.min(anchorRef.current, end),
            end: Math.max(anchorRef.current, end),
            text,
          });
        }
        return;
      }
      if (paged) {
        const bounds = viewportRef.current?.getBoundingClientRect();
        if (bounds) {
          const zone = tapZone(event.clientX - bounds.left, bounds.width);
          if (zone === 'prev') return settleTo(-1);
          if (zone === 'next') return settleTo(1);
        }
      }
      propsRef.current.onTap?.();
    },
    [paged, paintExtend, settleTo],
  );

  const body = segments.map(({ start, runs }) => (
    <p key={start} data-po={start}>
      {applyMark(runs, start, mark).map((run, index) =>
        renderRun(run, index, theme, colors.hlAlpha),
      )}
    </p>
  ));

  return (
    <div
      ref={viewportRef}
      onClick={onClick}
      className={`inkread-reader relative h-full w-full ${paged ? 'overflow-hidden' : 'overflow-y-auto'}`}
      style={{ background: colors.bg, overscrollBehaviorX: 'none' }}
    >
      <style>{readerCss(theme, fontSize)}</style>
      <div
        ref={contentRef}
        style={
          paged
            ? {
                boxSizing: 'border-box',
                width: contentWidth,
                height: Math.max(1, size.height - PAGE_INSET),
                margin: '20px auto 24px',
                columnWidth: contentWidth,
                columnGap: COLUMN_GAP,
                columnFill: 'auto',
                // Columns past the first spill out of this centred box; the
                // viewport clips them, so a page slides fully edge-to-edge on
                // the compositor rather than via scrollLeft.
                overflow: 'visible',
                willChange: 'transform',
                backfaceVisibility: 'hidden',
              }
            : { padding: '16px 20px 44px' }
        }
      >
        <h1>{title}</h1>
        {body}
      </div>
    </div>
  );
});
