import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';
import {
  HIGHLIGHT_COLORS,
  paginate,
  segmentChapterRuns,
  type Annotation,
} from '@inkread/core';

/**
 * PROTOTYPE — a pure-React-Native paginated reader, built alongside (not yet
 * replacing) the WebView reader while we migrate off the WebView. See
 * NATIVE_READER.md for the full plan and what still blocks parity.
 *
 * How it works: render the chapter once as native <Text> (with nested <Text>
 * runs so highlights paint at the right characters — the run split comes from
 * core's `segmentChapterRuns`, the same offset math the WebView uses), let
 * <Text onTextLayout> hand us every line's box, run the pure `paginate()` engine
 * (unit-tested in core) to group lines into viewport-sized pages, then show
 * page N by translating the text block up by that page's `top` inside a clipped
 * viewport. No WebView, no multi-column reflow — native text, so paging hits the
 * UI thread.
 *
 * Not yet here (each needs on-device native work): a smooth horizontal turn
 * gesture (Reanimated), text selection → offsets (the one piece that needs a
 * native TextKit module — see NATIVE_READER.md), tapping a highlight to edit,
 * and TTS sentence sync. This scaffold proves measure→segment→paginate→render;
 * the rest is the migration's real cost.
 */
export interface NativeReaderProps {
  paragraphs: string[];
  annotations: Annotation[];
  fontSize: number;
  lineHeight: number;
  color: string;
  background: string;
  /** Highlight fill opacity (matches the reader theme's hlAlpha). */
  highlightAlpha?: number;
  /** Tap outside the edge zones — used to toggle the reader chrome. */
  onTapCenter?: () => void;
  /** Turned past the last page — advance to the next chapter. */
  onReachEnd?: () => void;
  /** Turned before the first page — go to the previous chapter. */
  onReachStart?: () => void;
}

/** #rrggbb from a "r, g, b" triple → rgba() with the theme's highlight alpha. */
function highlightFill(color: string, alpha: number): string {
  const rgb = HIGHLIGHT_COLORS[color] ?? HIGHLIGHT_COLORS.yellow!;
  return `rgba(${rgb}, ${alpha})`;
}

export function NativeReader({
  paragraphs,
  annotations,
  fontSize,
  lineHeight,
  color,
  background,
  highlightAlpha = 0.4,
  onTapCenter,
  onReachEnd,
  onReachStart,
}: NativeReaderProps) {
  const [height, setHeight] = useState(0);
  const [lines, setLines] = useState<{ y: number; height: number }[]>([]);
  const [page, setPage] = useState(0);

  // Chapter → nested <Text> children: a blank line between paragraphs, each
  // paragraph split into plain / highlighted runs. Rendered as one <Text> tree
  // so onTextLayout still measures every wrapped line for pagination.
  const children = useMemo(() => {
    const paras = segmentChapterRuns(paragraphs, annotations);
    return paras.flatMap(({ runs }, pIndex) => {
      const runNodes = runs.map((run, rIndex) => (
        <Text
          key={`${pIndex}:${rIndex}`}
          style={
            run.annotation
              ? {
                  backgroundColor: highlightFill(run.annotation.color, highlightAlpha),
                  textDecorationLine: run.annotation.note ? 'underline' : 'none',
                }
              : undefined
          }
        >
          {run.text}
        </Text>
      ));
      // Separate paragraphs with a blank line (kept as its own node so the
      // paragraph gap survives the run flattening).
      return pIndex < paras.length - 1
        ? [...runNodes, <Text key={`gap:${pIndex}`}>{'\n\n'}</Text>]
        : runNodes;
    });
  }, [paragraphs, annotations, highlightAlpha]);

  const pages = useMemo(
    () => (height > 0 && lines.length > 0 ? paginate(lines, height) : []),
    [lines, height],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    setHeight(event.nativeEvent.layout.height);
  };

  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    // Only measure once; re-layouts (e.g. from the translate) report the same boxes.
    setLines((prev) =>
      prev.length === event.nativeEvent.lines.length
        ? prev
        : event.nativeEvent.lines.map((l) => ({ y: l.y, height: l.height })),
    );
  };

  const turn = (delta: number) => {
    const next = page + delta;
    if (next < 0) return onReachStart?.();
    if (pages.length > 0 && next >= pages.length) return onReachEnd?.();
    setPage(Math.max(0, next));
  };

  const top = pages[Math.min(page, Math.max(0, pages.length - 1))]?.top ?? 0;

  return (
    <View style={[styles.viewport, { backgroundColor: background }]} onLayout={onLayout}>
      <Text
        style={[styles.text, { fontSize, lineHeight, color, transform: [{ translateY: -top }] }]}
        onTextLayout={onTextLayout}
      >
        {children}
      </Text>
      {/* Edge tap zones: left third = previous page, right third = next, and the
          middle summons the chrome (mirrors the WebView reader's tap model). */}
      <Pressable style={[styles.zone, styles.left]} onPress={() => turn(-1)} />
      <Pressable style={[styles.zone, styles.center]} onPress={() => onTapCenter?.()} />
      <Pressable style={[styles.zone, styles.right]} onPress={() => turn(1)} />
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  text: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
  },
  zone: { position: 'absolute', top: 0, bottom: 0 },
  left: { left: 0, width: '30%' },
  center: { left: '30%', width: '40%' },
  right: { right: 0, width: '30%' },
});
