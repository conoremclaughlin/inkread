import { useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, View, type NativeSyntheticEvent } from 'react-native';
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
 * Phase-2 scope: render + native selection → highlight + tap-a-highlight. Paged
 * mode, cross-paragraph drag-select, TTS sentence marks and precise position
 * persistence come next (kept in the WebView reader until then).
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
  /** Fired with chapter-relative offsets, or undefined when the selection clears. */
  onSelection: (selection: { start: number; end: number; text: string } | undefined) => void;
  onTapHighlight: (id: string) => void;
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
  onSelection,
  onTapHighlight,
}: NativeReaderViewProps) {
  const fullText = useMemo(() => paragraphs.join('\n'), [paragraphs]);
  const paras = useMemo(
    () => segmentChapterRuns(paragraphs, annotations),
    [paragraphs, annotations],
  );

  // The paragraph whose selection is currently live. When another paragraph
  // reports a selection we treat the previous one as cleared, so only one
  // selection is ever active (independent UITextViews don't clear each other).
  const activeParaRef = useRef<number | undefined>(undefined);

  const handleSelection = (paraIndex: number, base: number) => (event: NativeSyntheticEvent<unknown> | SelectionEvent) => {
    const { start, end } = (event as SelectionEvent).nativeEvent;
    if (end <= start) {
      // Collapsed — only clear if this is the paragraph that owned the selection.
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

  // Match the WebView reader's serif so switching engines doesn't change the type.
  const bodyStyle = { fontFamily: 'Georgia', fontSize, lineHeight, color };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: background }]}
      contentContainerStyle={styles.content}
    >
      <UITextView
        style={[styles.title, { color, fontSize: Math.round(fontSize * 1.45) }]}
        uiTextView
      >
        {title}
      </UITextView>
      {paras.map(({ start, runs }, paraIndex) => (
        <UITextView
          key={paraIndex}
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
