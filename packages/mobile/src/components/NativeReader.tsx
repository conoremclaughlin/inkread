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
import { paginate } from '@inkread/core';

/**
 * PROTOTYPE — a pure-React-Native paginated reader, built alongside (not
 * replacing) the WebView reader while we evaluate going native for performance.
 *
 * How it works: render the chapter text once so <Text onTextLayout> hands us
 * every line's box, run the pure `paginate()` engine (unit-tested in core) to
 * group lines into viewport-sized pages, then show page N by translating the
 * text block up by that page's `top` inside a clipped viewport. No WebView, no
 * multi-column reflow — native text, so scrolling/paging can hit the UI thread.
 *
 * Not yet here (each needs on-device work): a smooth horizontal turn gesture
 * (Reanimated), text selection → offsets, highlight rendering, and TTS sentence
 * sync — the things the WebView currently gives for free. This scaffold proves
 * the measure→paginate→render path; the rest is the migration's real cost.
 */
export interface NativeReaderProps {
  paragraphs: string[];
  fontSize: number;
  lineHeight: number;
  color: string;
  background: string;
  /** Turned past the last page — advance to the next chapter. */
  onReachEnd?: () => void;
  /** Turned before the first page — go to the previous chapter. */
  onReachStart?: () => void;
}

export function NativeReader({
  paragraphs,
  fontSize,
  lineHeight,
  color,
  background,
  onReachEnd,
  onReachStart,
}: NativeReaderProps) {
  const text = useMemo(() => paragraphs.join('\n\n'), [paragraphs]);
  const [height, setHeight] = useState(0);
  const [lines, setLines] = useState<{ y: number; height: number }[]>([]);
  const [page, setPage] = useState(0);

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
        {text}
      </Text>
      {/* Edge tap zones: left third = previous page, right third = next. */}
      <Pressable style={[styles.zone, styles.left]} onPress={() => turn(-1)} />
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
  zone: { position: 'absolute', top: 0, bottom: 0, width: '33%' },
  left: { left: 0 },
  right: { right: 0 },
});
