import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { UITextView } from '@bsky.app/react-native-uitextview';
import { applyMark, segmentChapterRuns, type Annotation, type Run } from '@inkread/core';
import { renderRun } from './readerRuns';

/**
 * Pure-React-Native chapter reader (no WebView), scroll mode. Each paragraph is
 * a native `UITextView` (@bsky.app/react-native-uitextview) so iOS gives us real
 * text selection AND hands back `[start,end)` character offsets — the one thing
 * RN core's <Text> can't do. Highlights render as `backgroundColor` on nested
 * runs (validated on-device; see ink://inkread/specs/native-reader).
 *
 * Offset model (shared with the WebView via core's `segmentChapterRuns`): the
 * chapter's plain text is `paragraphs.join('\n')`. A paragraph's own UITextView
 * reports selection offsets relative to *its* text; we add that paragraph's base
 * offset to get chapter-relative offsets that match every annotation locator.
 *
 * Ported from the WebView reader: selection→offsets, tap-a-highlight, reading
 * position (report on scroll + restore on open), chrome show/hide driven by
 * scroll direction (a tap toggle would fight the native selection gesture), and
 * the TTS sentence mark — the read-along tint on the sentence being spoken,
 * which also scrolls itself into view as playback advances.
 */
export interface NativeReaderViewProps {
  paragraphs: string[];
  title: string;
  /** Chapter-relative annotations (already filtered to this chapter). */
  annotations: Annotation[];
  fontSize: number;
  lineHeight: number;
  color: string;
  background: string;
  /** Highlight fill opacity — the active theme's hlAlpha. */
  highlightAlpha: number;
  /** Character offset to restore to on open (top of viewport). */
  initialOffset?: number;
  /** The sentence TTS is speaking, as a chapter-relative range (read-along tint). */
  ttsMark?: { start: number; end: number };
  /** Fired with chapter-relative offsets, or undefined when the selection clears. */
  onSelection: (selection: { start: number; end: number; text: string } | undefined) => void;
  onTapHighlight: (id: string) => void;
  /** Top-of-viewport character offset as the reader scrolls (for persistence). */
  onOffsetChange?: (offset: number) => void;
  /** Show/hide the reader chrome (driven by scroll direction). */
  onChromeVisibility?: (visible: boolean) => void;
}

type SelectionEvent = { nativeEvent: { start: number; end: number } };

/**
 * One paragraph, memoised so a moving TTS mark only re-renders the paragraph it
 * enters and the one it leaves — not the whole chapter, sentence after sentence.
 * Every prop is a stable reference or a primitive except `mark`, which the
 * parent hands only to the paragraph the mark currently touches.
 */
interface ParagraphProps {
  index: number;
  base: number;
  runs: Run[];
  mark?: { start: number; end: number };
  style: StyleProp<TextStyle>;
  highlightAlpha: number;
  onSelect: (paraIndex: number, base: number, event: SelectionEvent) => void;
  onTapHighlight: (id: string) => void;
  onLayoutY: (index: number, y: number) => void;
}

const MarkableParagraph = memo(function MarkableParagraph({
  index,
  base,
  runs,
  mark,
  style,
  highlightAlpha,
  onSelect,
  onTapHighlight,
  onLayoutY,
}: ParagraphProps) {
  const marked = applyMark(runs, base, mark);
  return (
    <View onLayout={(e: LayoutChangeEvent) => onLayoutY(index, e.nativeEvent.layout.y)}>
      <UITextView
        selectable
        uiTextView
        onSelectionChange={(e) => onSelect(index, base, e as SelectionEvent)}
        style={style}
      >
        {marked.map((run, runIndex) => renderRun(run, String(runIndex), { highlightAlpha, onTapHighlight }))}
      </UITextView>
    </View>
  );
});

export function NativeReaderView({
  paragraphs,
  title,
  annotations,
  fontSize,
  lineHeight,
  color,
  background,
  highlightAlpha,
  initialOffset = 0,
  ttsMark,
  onSelection,
  onTapHighlight,
  onOffsetChange,
  onChromeVisibility,
}: NativeReaderViewProps) {
  const fullText = useMemo(() => paragraphs.join('\n'), [paragraphs]);
  const paras = useMemo(
    () => segmentChapterRuns(paragraphs, annotations),
    [paragraphs, annotations],
  );

  const scrollRef = useRef<ScrollView>(null);
  // Y offset of each paragraph within the scroll content (from onLayout).
  const paraY = useRef<number[]>([]);
  const restoredRef = useRef(false);
  const lastScrollY = useRef(0);
  const lastReportedOffset = useRef(-1);
  const [viewportH, setViewportH] = useState(0);
  // The paragraph whose selection is currently live. When another paragraph
  // reports a selection we treat the previous one as cleared, so only one
  // selection is ever active (independent UITextViews don't clear each other).
  const activeParaRef = useRef<number | undefined>(undefined);

  // Show the chrome when a chapter opens (this view is keyed per chapter, so it
  // remounts each time). Without an initial scroll event the scroll-direction
  // logic would never fire, leaving the controls unreachable. Scrolling down
  // into the text then hides it; scrolling back up brings it back.
  useEffect(() => {
    onChromeVisibility?.(true);
  }, [onChromeVisibility]);

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

  // Restore to the paragraph containing `initialOffset` once its box is measured.
  const restoreIndex = useMemo(
    () => (initialOffset > 0 ? paraIndexForOffset(initialOffset) : -1),
    [initialOffset, paraIndexForOffset],
  );

  const maybeRestore = useCallback(() => {
    if (restoredRef.current || restoreIndex < 0) return;
    const y = paraY.current[restoreIndex];
    if (y == null) return;
    restoredRef.current = true;
    // Defer so the ScrollView has its content height before we jump.
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: false }),
    );
  }, [restoreIndex]);

  const handleLayoutY = useCallback(
    (index: number, y: number) => {
      paraY.current[index] = y;
      maybeRestore();
    },
    [maybeRestore],
  );

  const handleSelect = useCallback(
    (paraIndex: number, base: number, event: SelectionEvent) => {
      const { start, end } = event.nativeEvent;
      if (end <= start) {
        if (activeParaRef.current === paraIndex) {
          activeParaRef.current = undefined;
          onSelection(undefined);
        }
        return;
      }
      activeParaRef.current = paraIndex;
      const from = base + start;
      const to = base + end;
      const text = fullText.slice(from, to);
      if (text.trim().length === 0) {
        onSelection(undefined);
        return;
      }
      onSelection({ start: from, end: to, text });
    },
    [fullText, onSelection],
  );

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;

    // Chrome follows scroll direction: shown at the top and when scrolling up,
    // hidden when scrolling down into the text (immersive), without a tap that
    // would collide with the native text-selection gesture.
    if (onChromeVisibility) {
      if (y <= 6) onChromeVisibility(true);
      else if (y > lastScrollY.current + 6) onChromeVisibility(false);
      else if (y < lastScrollY.current - 6) onChromeVisibility(true);
    }
    lastScrollY.current = y;

    // Report the top-visible paragraph's chapter offset for position persistence.
    if (onOffsetChange) {
      let offset = 0;
      for (let i = 0; i < paras.length; i++) {
        const py = paraY.current[i];
        if (py != null && py <= y + 8) offset = paras[i]!.start;
        else if (py != null) break;
      }
      if (offset !== lastReportedOffset.current) {
        lastReportedOffset.current = offset;
        onOffsetChange(offset);
      }
    }
  };

  // Keep the spoken sentence on screen: when the mark moves to a paragraph that
  // isn't comfortably in view, ease it toward the upper third. We only scroll
  // when it's actually off the comfortable band, so successive sentences within
  // one visible paragraph don't jitter the page.
  useEffect(() => {
    if (!ttsMark || viewportH === 0) return;
    const y = paraY.current[paraIndexForOffset(ttsMark.start)];
    if (y == null) return;
    const top = lastScrollY.current;
    if (y < top + 48 || y > top + viewportH - 96) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - viewportH * 0.3), animated: true });
    }
  }, [ttsMark, viewportH, paraIndexForOffset]);

  const bodyStyle = useMemo<StyleProp<TextStyle>>(
    () => [styles.paragraph, { fontFamily: 'Georgia', fontSize, lineHeight, color }],
    [fontSize, lineHeight, color],
  );

  const markEnd = ttsMark?.end ?? -1;
  const markStart = ttsMark?.start ?? -1;

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.scroll, { backgroundColor: background }]}
      contentContainerStyle={styles.content}
      scrollEventThrottle={16}
      onScroll={handleScroll}
      onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
    >
      <UITextView
        style={[styles.title, { color, fontSize: Math.round(fontSize * 1.45) }]}
        uiTextView
      >
        {title}
      </UITextView>
      {paras.map(({ start, runs }, paraIndex) => {
        const paraEnd = start + (paragraphs[paraIndex]?.length ?? 0);
        const mark = ttsMark && markStart < paraEnd && markEnd > start ? ttsMark : undefined;
        return (
          <MarkableParagraph
            key={paraIndex}
            index={paraIndex}
            base={start}
            runs={runs}
            mark={mark}
            style={bodyStyle}
            highlightAlpha={highlightAlpha}
            onSelect={handleSelect}
            onTapHighlight={onTapHighlight}
            onLayoutY={handleLayoutY}
          />
        );
      })}
      <View style={styles.tail} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16 },
  title: { fontFamily: 'Georgia', fontWeight: '700', marginBottom: 20 },
  paragraph: { marginBottom: 16, textAlign: 'justify' },
  tail: { height: 96 },
});
