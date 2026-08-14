import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { UITextView } from '@bsky.app/react-native-uitextview';
import { applyMark, segmentChapterRuns, type Annotation } from '@inkread/core';
import {
  modelOffsetForRendered,
  pageForRenderedOffset,
  renderedOffsetAtPage,
  renderedOffsetForModel,
  renderedParagraphStarts,
} from '../lib/pagedOffsets';
import { renderRun } from './readerRuns';

/**
 * Native paged reader. Rather than clip + translate a selectable view (which can
 * break native selection), we put the chapter in a **non-scrollable** ScrollView
 * and page it with programmatic `scrollTo` — so selection behaves exactly as it
 * does in scroll mode, while turns move a screenful at a time. The body is one
 * `UITextView` (uniform line grid via a single `lineHeight`, paragraphs joined by
 * '\n' to match the `segmentChapterRuns` offset model), so a page step of
 * whole-lines snaps cleanly without slicing a line across the fold.
 *
 * Turns are edge taps (left/right thirds); the middle is left for selection.
 * Past the first/last page we flow into the neighbouring chapter.
 *
 * The TTS sentence mark tints the sentence being spoken. Because the body is one
 * UITextView we have no per-character geometry, so page-follow is estimated from
 * the mark's position in the text (see the effect below) — good enough to keep
 * the spoken line on the visible page as playback advances.
 */
export interface NativePagedViewProps {
  paragraphs: string[];
  title: string;
  annotations: Annotation[];
  fontSize: number;
  lineHeight: number;
  color: string;
  background: string;
  highlightAlpha: number;
  /** The sentence TTS is speaking, as a chapter-relative range (read-along tint). */
  ttsMark?: { start: number; end: number };
  /**
   * Where to open. Number.MAX_SAFE_INTEGER means "the last page" — how the
   * reader flows in when you turn back into the previous chapter.
   */
  initialOffset?: number;
  onSelection: (selection: { start: number; end: number; text: string } | undefined) => void;
  onTapHighlight: (id: string) => void;
  onReachStart: () => void;
  onReachEnd: () => void;
  /** The chapter offset now at the top of the page — the reading position. */
  onOffsetChange?: (offset: number) => void;
  /** Reveal the chrome when the chapter opens (paged mode has no scroll signal). */
  onChromeVisibility?: (visible: boolean) => void;
}

type SelectionEvent = { nativeEvent: { start: number; end: number } };

export function NativePagedView({
  paragraphs,
  title,
  annotations,
  fontSize,
  lineHeight,
  color,
  background,
  highlightAlpha,
  ttsMark,
  initialOffset = 0,
  onSelection,
  onTapHighlight,
  onReachStart,
  onReachEnd,
  onOffsetChange,
  onChromeVisibility,
}: NativePagedViewProps) {
  useEffect(() => {
    onChromeVisibility?.(true);
  }, [onChromeVisibility]);

  // Body only (no title) so selection offsets are chapter-relative with no base
  // to subtract; the chapter title lives in the bottom chrome bar.
  const body = useMemo(() => paragraphs.join('\n'), [paragraphs]);
  const paras = useMemo(
    () => segmentChapterRuns(paragraphs, annotations),
    [paragraphs, annotations],
  );
  // We render a blank line ('\n\n') between paragraphs for readable spacing,
  // while the offset model uses a single '\n'. Each paragraph p therefore starts
  // p chars later in the rendered text, so a rendered offset maps to the model
  // by subtracting the index of the paragraph it falls in (`r - p`).
  const renderedStarts = useMemo(
    () => renderedParagraphStarts(paras.map((p) => p.start)),
    [paras],
  );

  const scrollRef = useRef<ScrollView>(null);
  const [viewportH, setViewportH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [page, setPage] = useState(0);
  // Current page mirrored in a ref so the TTS page-follow effect can compare
  // against it without depending on `page` (which would fight a manual turn).
  const pageRef = useRef(0);
  const activeRef = useRef(false);

  // Whole-line page step so a turn never leaves a half-line at the fold.
  const pageStep = Math.max(lineHeight, Math.floor((viewportH - 24) / lineHeight) * lineHeight);
  const totalPages = Math.max(1, Math.ceil(contentH / pageStep));

  const metrics = useMemo(
    () => ({
      renderedTotal: body.length + Math.max(0, paras.length - 1),
      contentHeight: contentH,
      pageStep,
      totalPages,
    }),
    [body.length, paras.length, contentH, pageStep, totalPages],
  );

  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(totalPages - 1, next));
      pageRef.current = clamped;
      setPage(clamped);
      scrollRef.current?.scrollTo({ y: clamped * pageStep, animated: true });
      // The top of the page is where reading has got to.
      onOffsetChange?.(
        modelOffsetForRendered(renderedStarts, renderedOffsetAtPage(clamped, metrics)),
      );
    },
    [totalPages, pageStep, onOffsetChange, renderedStarts, metrics],
  );

  // Open where reading stopped. Waits for layout (the page a character sits on
  // is estimated from measured heights) and runs once per chapter. The landing
  // reports back, which is how the "last page" sentinel becomes a real offset.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || contentH === 0 || pageStep === 0) return;
    restoredRef.current = true;
    if (initialOffset <= 0) return;
    const rendered =
      initialOffset >= Number.MAX_SAFE_INTEGER
        ? Number.MAX_SAFE_INTEGER
        : renderedOffsetForModel(
            paras.map((p) => p.start),
            initialOffset,
          );
    const target = pageForRenderedOffset(rendered, metrics);
    if (target > 0) goToPage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentH, pageStep]);

  const turn = (delta: number) => {
    const next = page + delta;
    if (next < 0) return onReachStart();
    if (next >= totalPages) return onReachEnd();
    goToPage(next);
  };

  const onViewportLayout = (e: LayoutChangeEvent) => setViewportH(e.nativeEvent.layout.height);

  const paraIndexForOffset = useCallback(
    (offset: number) => {
      let target = 0;
      for (let i = 0; i < paras.length; i++) {
        if (paras[i]!.start <= offset) target = i;
        else break;
      }
      return target;
    },
    [paras],
  );

  // Follow the spoken sentence. With no per-character geometry in a single
  // UITextView, we estimate the mark's vertical position from its share of the
  // rendered text (rendered length adds one '\n' per paragraph gap) and turn to
  // that page. Reads `pageRef` rather than `page` so a manual turn isn't undone.
  useEffect(() => {
    if (!ttsMark || contentH === 0 || pageStep === 0) return;
    const renderedMarkStart = ttsMark.start + paraIndexForOffset(ttsMark.start);
    const target = pageForRenderedOffset(renderedMarkStart, metrics);
    if (target !== pageRef.current) goToPage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsMark, contentH, pageStep]);

  const handleSelection = (event: NativeSyntheticEvent<unknown> | SelectionEvent) => {
    const { start, end } = (event as SelectionEvent).nativeEvent;
    if (end <= start) {
      if (activeRef.current) {
        activeRef.current = false;
        onSelection(undefined);
      }
      return;
    }
    const from = modelOffsetForRendered(renderedStarts, start);
    const to = modelOffsetForRendered(renderedStarts, end);
    const text = body.slice(from, to);
    if (text.trim().length === 0) {
      onSelection(undefined);
      return;
    }
    activeRef.current = true;
    onSelection({ start: from, end: to, text });
  };

  return (
    <View style={[styles.viewport, { backgroundColor: background }]} onLayout={onViewportLayout}>
      <ScrollView
        ref={scrollRef}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        onContentSizeChange={(_w, h) => setContentH(h)}
      >
        <UITextView
          selectable
          uiTextView
          onSelectionChange={handleSelection}
          style={{ fontFamily: 'Georgia', fontSize, lineHeight, color }}
        >
          {paras.flatMap(({ runs, start }, pIndex) => {
            const marked = applyMark(runs, start, ttsMark);
            const nodes = marked.map((run, rIndex) =>
              renderRun(run, `${pIndex}:${rIndex}`, { highlightAlpha, onTapHighlight }),
            );
            return pIndex < paras.length - 1
              ? [...nodes, <UITextView key={`nl:${pIndex}`}>{'\n\n'}</UITextView>]
              : nodes;
          })}
        </UITextView>
      </ScrollView>
      {/* Edge taps turn pages; the middle stays selectable. */}
      <Pressable style={[styles.zone, styles.left]} onPress={() => turn(-1)} />
      <Pressable style={[styles.zone, styles.right]} onPress={() => turn(1)} />
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  zone: { position: 'absolute', top: 0, bottom: 0, width: '24%' },
  left: { left: 0 },
  right: { right: 0 },
});
