import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { UITextView } from '@bsky.app/react-native-uitextview';
import { HIGHLIGHT_COLORS, segmentChapterRuns, type Annotation } from '@inkread/core';

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
 * position (report on scroll + restore on open), and chrome show/hide driven by
 * scroll direction (a tap toggle would fight the native selection gesture).
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
  /** Fired with chapter-relative offsets, or undefined when the selection clears. */
  onSelection: (selection: { start: number; end: number; text: string } | undefined) => void;
  onTapHighlight: (id: string) => void;
  /** Top-of-viewport character offset as the reader scrolls (for persistence). */
  onOffsetChange?: (offset: number) => void;
  /** Show/hide the reader chrome (driven by scroll direction). */
  onChromeVisibility?: (visible: boolean) => void;
}

type SelectionEvent = { nativeEvent: { start: number; end: number } };

function highlightFill(color: string, alpha: number): string {
  const rgb = HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS.yellow!;
  return `rgba(${rgb}, ${alpha})`;
}

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

  // Restore to the paragraph containing `initialOffset` once its box is measured.
  const restoreIndex = useMemo(() => {
    if (initialOffset <= 0) return -1;
    let target = 0;
    for (let i = 0; i < paras.length; i++) {
      if (paras[i]!.start <= initialOffset) target = i;
      else break;
    }
    return target;
  }, [initialOffset, paras]);

  const maybeRestore = useCallback(() => {
    if (restoredRef.current || restoreIndex < 0) return;
    const y = paraY.current[restoreIndex];
    if (y == null) return;
    restoredRef.current = true;
    // Defer so the ScrollView has its content height before we jump.
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: false }));
  }, [restoreIndex]);

  const handleParaLayout = (index: number) => (y: number) => {
    paraY.current[index] = y;
    maybeRestore();
  };

  const handleSelection =
    (paraIndex: number, base: number) =>
    (event: NativeSyntheticEvent<unknown> | SelectionEvent) => {
      const { start, end } = (event as SelectionEvent).nativeEvent;
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
    };

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

  const bodyStyle = { fontFamily: 'Georgia', fontSize, lineHeight, color };

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.scroll, { backgroundColor: background }]}
      contentContainerStyle={styles.content}
      scrollEventThrottle={16}
      onScroll={handleScroll}
    >
      <UITextView
        style={[styles.title, { color, fontSize: Math.round(fontSize * 1.45) }]}
        uiTextView
      >
        {title}
      </UITextView>
      {paras.map(({ start, runs }, paraIndex) => (
        <View
          key={paraIndex}
          onLayout={(e) => handleParaLayout(paraIndex)(e.nativeEvent.layout.y)}
        >
          <UITextView
            selectable
            uiTextView
            onSelectionChange={handleSelection(paraIndex, start)}
            style={[styles.paragraph, bodyStyle]}
          >
            {runs.map((run, runIndex) =>
              run.annotation ? (
                <UITextView
                  key={runIndex}
                  style={{ backgroundColor: highlightFill(run.annotation.color, highlightAlpha) }}
                  onPress={() => onTapHighlight(run.annotation!.id)}
                >
                  {run.text}
                </UITextView>
              ) : (
                run.text
              ),
            )}
          </UITextView>
        </View>
      ))}
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
