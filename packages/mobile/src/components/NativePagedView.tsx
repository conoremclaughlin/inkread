import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { UITextView } from '@bsky.app/react-native-uitextview';
import { HIGHLIGHT_COLORS, segmentChapterRuns, type Annotation } from '@inkread/core';

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
  onSelection: (selection: { start: number; end: number; text: string } | undefined) => void;
  onTapHighlight: (id: string) => void;
  onReachStart: () => void;
  onReachEnd: () => void;
  /** Reveal the chrome when the chapter opens (paged mode has no scroll signal). */
  onChromeVisibility?: (visible: boolean) => void;
}

type SelectionEvent = { nativeEvent: { start: number; end: number } };

function highlightFill(color: string, alpha: number): string {
  const rgb = HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS.yellow!;
  return `rgba(${rgb}, ${alpha})`;
}

export function NativePagedView({
  paragraphs,
  title,
  annotations,
  fontSize,
  lineHeight,
  color,
  background,
  highlightAlpha,
  onSelection,
  onTapHighlight,
  onReachStart,
  onReachEnd,
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

  const scrollRef = useRef<ScrollView>(null);
  const [viewportH, setViewportH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [page, setPage] = useState(0);
  const activeRef = useRef(false);

  // Whole-line page step so a turn never leaves a half-line at the fold.
  const pageStep = Math.max(lineHeight, Math.floor((viewportH - 24) / lineHeight) * lineHeight);
  const totalPages = Math.max(1, Math.ceil(contentH / pageStep));

  const goToPage = (next: number) => {
    const clamped = Math.max(0, Math.min(totalPages - 1, next));
    setPage(clamped);
    scrollRef.current?.scrollTo({ y: clamped * pageStep, animated: true });
  };

  const turn = (delta: number) => {
    const next = page + delta;
    if (next < 0) return onReachStart();
    if (next >= totalPages) return onReachEnd();
    goToPage(next);
  };

  const onViewportLayout = (e: LayoutChangeEvent) => setViewportH(e.nativeEvent.layout.height);

  const handleSelection = (event: NativeSyntheticEvent<unknown> | SelectionEvent) => {
    const { start, end } = (event as SelectionEvent).nativeEvent;
    if (end <= start) {
      if (activeRef.current) {
        activeRef.current = false;
        onSelection(undefined);
      }
      return;
    }
    const text = body.slice(start, end);
    if (text.trim().length === 0) {
      onSelection(undefined);
      return;
    }
    activeRef.current = true;
    onSelection({ start, end, text });
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
          {paras.flatMap(({ runs }, pIndex) => {
            const nodes = runs.map((run, rIndex) =>
              run.annotation ? (
                <UITextView
                  key={`${pIndex}:${rIndex}`}
                  style={{ backgroundColor: highlightFill(run.annotation.color, highlightAlpha) }}
                  onPress={() => onTapHighlight(run.annotation!.id)}
                >
                  {run.text}
                </UITextView>
              ) : (
                run.text
              ),
            );
            return pIndex < paras.length - 1
              ? [...nodes, <UITextView key={`nl:${pIndex}`}>{'\n'}</UITextView>]
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
