import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  formatPassageShare,
  type Annotation,
  type Chapter,
  type HighlightColor,
} from '@inkread/core';
import type { RootStackParamList } from '../navigation';
import {
  buildReaderHtml,
  HIGHLIGHT_COLORS,
  READER_THEMES,
  type ReaderTheme,
} from '@inkread/core';
import {
  createAnnotation,
  deleteAnnotation,
  loadBook,
  persistPosition,
  refreshAnnotations,
  updateAnnotationNote,
  type LoadedBook,
} from '../lib/libraryData';
import {
  loadPreferences,
  savePreferences,
  type ReaderPreferences,
} from '../lib/preferences';
import { TtsController, pickBestVoice } from '../tts/TtsController';
import { colors } from '../ui/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = NativeStackScreenProps<RootStackParamList, 'Reader'>;

interface Selection {
  start: number;
  end: number;
  text: string;
}

const THEME_LABELS: Partial<Record<ReaderTheme, string>> = {
  paper: 'Paper',
  sepia: 'Sepia',
  calm: 'Calm',
  quiet: 'Quiet',
  night: 'Night',
  midnight: 'Midnight',
};

const THEME_PREVIEWS = (Object.keys(THEME_LABELS) as ReaderTheme[]).map((key) => ({
  key,
  label: THEME_LABELS[key]!,
  bg: READER_THEMES[key].bg,
  fg: READER_THEMES[key].fg,
}));

const RATES = [0.9, 1.0, 1.15, 1.3, 1.5];
const DEFAULT_FONT_SIZE = 19;

/** #rgb / #rrggbb → rgba() string, so theme colors can be tinted for borders etc. */
function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Panel palette derived from the active reader theme, mirroring the web CSS vars. */
function panelFor(theme: ReaderTheme) {
  const t = READER_THEMES[theme] ?? READER_THEMES.paper;
  return {
    bg: t.bg,
    fg: t.fg,
    muted: withAlpha(t.fg, 0.55),
    border: withAlpha(t.fg, 0.16),
    accent: t.accent,
  };
}

/**
 * Transport glyphs drawn as views (triangles via borders, bars as rects) so
 * they take the theme color — emoji ignore `color` and break in dark mode.
 * Shapes mirror the desktop PlayerIcon.
 */
function PlayerIcon({
  kind,
  color,
  size = 9,
}: {
  kind: 'prev' | 'play' | 'pause' | 'next';
  color: string;
  size?: number;
}) {
  const bar: ViewStyle = {
    width: Math.max(2, Math.round(size * 0.34)),
    height: size * 2,
    borderRadius: 1,
    backgroundColor: color,
  };
  const tri = (dir: 'left' | 'right'): ViewStyle => ({
    width: 0,
    height: 0,
    borderTopWidth: size,
    borderBottomWidth: size,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    ...(dir === 'right'
      ? { borderLeftWidth: size * 1.5, borderLeftColor: color }
      : { borderRightWidth: size * 1.5, borderRightColor: color }),
  });
  if (kind === 'play') return <View style={tri('right')} />;
  if (kind === 'pause')
    return (
      <View style={{ flexDirection: 'row', gap: size * 0.5 }}>
        <View style={bar} />
        <View style={bar} />
      </View>
    );
  if (kind === 'prev')
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <View style={bar} />
        <View style={tri('left')} />
      </View>
    );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <View style={tri('right')} />
      <View style={bar} />
    </View>
  );
}

export function ReaderScreen(props: Props) {
  const { bookId } = props.route.params;
  const [data, setData] = useState<
    { loaded: LoadedBook; preferences: ReaderPreferences } | null | undefined
  >(undefined);
  useEffect(() => {
    void Promise.all([loadBook(bookId), loadPreferences()]).then(([loaded, preferences]) =>
      setData(loaded ? { loaded, preferences } : null),
    );
  }, [bookId]);
  if (data === undefined) return <View style={styles.center} />;
  if (data === null) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.inkSoft }}>Book not found on this device yet.</Text>
      </View>
    );
  }
  return <ReaderInner {...props} loaded={data.loaded} preferences={data.preferences} />;
}

function ReaderInner({
  route,
  navigation,
  loaded,
  preferences,
}: Props & { loaded: LoadedBook; preferences: ReaderPreferences }) {
  const { bookId } = route.params;
  const book = loaded.book;
  const chapters = loaded.chapters;
  const initialPosition = loaded.position;

  const [chapterIndex, setChapterIndex] = useState(
    Math.min(initialPosition?.chapterIndex ?? 0, chapters.length - 1),
  );
  const [theme, setTheme] = useState<ReaderTheme>(
    (preferences.theme as ReaderTheme | undefined) ?? 'paper',
  );
  const [fontSize, setFontSize] = useState(preferences.fontSize ?? DEFAULT_FONT_SIZE);
  const [pagination, setPagination] = useState<'scroll' | 'paged'>(
    preferences.pagination ?? 'scroll',
  );
  const [annotations, setAnnotations] = useState<Annotation[]>(loaded.annotations);
  const [selection, setSelection] = useState<Selection | undefined>();
  const [furthest, setFurthest] = useState(initialPosition?.furthest);
  // Immersive by default: pure text, tap the center to summon the chrome.
  const [chromeVisible, setChromeVisible] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [ttsVisible, setTtsVisible] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsRate, setTtsRate] = useState(preferences.ttsRate ?? 1.0);

  const webviewRef = useRef<WebView>(null);
  const restoreOffsetRef = useRef(initialPosition?.offset ?? 0);
  const ttsRef = useRef<TtsController | undefined>(undefined);
  const autoAdvanceRef = useRef(false);
  // Guards against a doubled "finished" notification advancing two chapters at
  // once; reset each time a chapter's queue is (re)loaded below.
  const ttsAdvancingRef = useRef(false);
  const ttsStaleRef = useRef(false);

  const chapter = chapters[chapterIndex];
  const chapterText = useMemo(() => chapter?.paragraphs.join('\n') ?? '', [chapter]);

  const insets = useSafeAreaInsets();
  const panel = useMemo(() => panelFor(theme), [theme]);
  // Theme-reactive chrome + safe-area padding, applied over the layout styles.
  const dyn = useMemo(
    () => ({
      topBar: { backgroundColor: withAlpha(panel.bg, 0.98), borderColor: panel.border },
      bottomBar: {
        backgroundColor: withAlpha(panel.bg, 0.98),
        borderColor: panel.border,
        paddingBottom: 12 + insets.bottom,
      },
      pill: {
        backgroundColor: panel.bg,
        borderColor: panel.border,
        borderWidth: StyleSheet.hairlineWidth,
        bottom: 56 + insets.bottom,
      },
      accentText: { color: panel.accent },
      mutedText: { color: panel.muted },
    }),
    [panel, insets],
  );

  // Keep the native nav header in step with the reader theme — no light bar
  // hanging over the top of the page in dark mode.
  useEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: panel.bg },
      headerTintColor: panel.accent,
      headerTitleStyle: { color: panel.fg },
    });
  }, [navigation, panel]);

  const html = useMemo(
    () =>
      chapter ? buildReaderHtml(chapter, annotations, { theme, fontSize, pagination }) : '',
    [chapter, annotations, theme, fontSize, pagination],
  );

  // Persist reading settings (debounced) so they follow the user across devices.
  const prefsLoaded = useRef(false);
  useEffect(() => {
    if (!prefsLoaded.current) {
      prefsLoaded.current = true;
      return;
    }
    const timer = setTimeout(() => {
      void savePreferences({ theme, fontSize, pagination, ttsRate });
    }, 600);
    return () => clearTimeout(timer);
  }, [theme, fontSize, pagination, ttsRate]);

  const reloadAnnotations = useCallback(() => {
    void refreshAnnotations(bookId).then(setAnnotations);
  }, [bookId]);

  // --- TTS -----------------------------------------------------------------
  const getTts = useCallback((): TtsController => {
    if (!ttsRef.current) ttsRef.current = new TtsController();
    return ttsRef.current;
  }, []);

  useEffect(() => {
    const tts = getTts();
    tts.setListener((status) => {
      setTtsPlaying(status.playing);
      if (status.sentence && status.playing) {
        webviewRef.current?.injectJavaScript(
          `window.__reader && window.__reader.markSentence(${status.sentence.start}, ${status.sentence.end});true;`,
        );
      }
      // Ran off the end of the chapter → advance and keep reading. Note the
      // terminal notification carries playing:false (speakCurrent clears it),
      // so this must not require status.playing.
      if (!status.sentence && tts.finished && status.totalSentences > 0) {
        if (ttsAdvancingRef.current) return;
        ttsAdvancingRef.current = true;
        setChapterIndex((index) => {
          if (index + 1 >= chapters.length) {
            ttsAdvancingRef.current = false;
            return index;
          }
          autoAdvanceRef.current = true;
          return index + 1;
        });
      }
    });
    return () => {
      tts.setListener(undefined);
      tts.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tts = getTts();
    const offset =
      restoreOffsetRef.current >= Number.MAX_SAFE_INTEGER
        ? Math.max(0, chapterText.length - 1)
        : restoreOffsetRef.current;
    ttsStaleRef.current = false;
    ttsAdvancingRef.current = false;
    if (autoAdvanceRef.current && chapterIndex < chapters.length) {
      autoAdvanceRef.current = false;
      tts.load(chapterText, 0);
      tts.play();
    } else if (ttsVisible) {
      tts.load(chapterText, offset);
    } else {
      tts.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex, chapterText]);

  const openTts = useCallback(async () => {
    const tts = getTts();
    const voice = await pickBestVoice(book?.language ?? 'en');
    tts.setVoice(voice?.identifier);
    ttsStaleRef.current = false;
    tts.load(chapterText, restoreOffsetRef.current);
    setTtsVisible(true);
    tts.play();
  }, [book?.language, chapterText, getTts]);

  const closeTts = useCallback(() => {
    getTts().stop();
    setTtsVisible(false);
    webviewRef.current?.injectJavaScript(
      'window.__reader && window.__reader.clearSentence();true;',
    );
  }, [getTts]);

  const toggleTtsPlay = useCallback(() => {
    const tts = getTts();
    if (ttsPlaying) {
      tts.stop();
      return;
    }
    // Turning pages while paused moves the reading position; play should
    // follow it rather than jump back to the old sentence.
    if (ttsStaleRef.current) {
      ttsStaleRef.current = false;
      tts.load(chapterText, restoreOffsetRef.current);
    }
    tts.play();
  }, [chapterText, getTts, ttsPlaying]);

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(ttsRate) + 1) % RATES.length]!;
    setTtsRate(next);
    getTts().setRate(next);
  }, [getTts, ttsRate]);

  // --- Annotations ---------------------------------------------------------
  const addHighlight = useCallback(
    (color: HighlightColor, note?: string) => {
      if (!selection || !chapter) return;
      setSelection(undefined);
      void createAnnotation(bookId, {
        chapterIndex,
        start: selection.start,
        end: selection.end,
        passage: selection.text,
        note,
        color,
        chapterTitle: chapter.title,
      })
        .then(reloadAnnotations)
        .catch((error) => Alert.alert('Could not save', String(error.message ?? error)));
    },
    [bookId, chapter, chapterIndex, reloadAnnotations, selection],
  );

  const promptNote = useCallback(() => {
    if (!selection) return;
    Alert.prompt('Add note', selection.text.slice(0, 120), (note) => {
      if (note !== null) addHighlight('yellow', note.trim() || undefined);
    });
  }, [addHighlight, selection]);

  const sharePassage = useCallback(
    (passage: string, note?: string) => {
      if (!book) return;
      void Share.share({ message: formatPassageShare(book, passage, note) });
    },
    [book],
  );

  const handleTapHighlight = useCallback(
    (id: string) => {
      const annotation = annotations.find((a) => a.id === id);
      if (!annotation) return;
      Alert.alert(
        annotation.note ? 'Note' : 'Highlight',
        annotation.note ? `${annotation.note}\n\n“${annotation.passage}”` : annotation.passage,
        [
          {
            text: annotation.note ? 'Edit note' : 'Add note',
            onPress: () =>
              Alert.prompt('Note', annotation.passage.slice(0, 120), (note) => {
                if (note !== null) {
                  void updateAnnotationNote(id, note.trim() || undefined)
                    .then(reloadAnnotations)
                    .catch((error) => Alert.alert('Could not save', String(error.message ?? error)));
                }
              }, 'plain-text', annotation.note),
          },
          { text: 'Share', onPress: () => sharePassage(annotation.passage, annotation.note) },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              void deleteAnnotation(id)
                .then(reloadAnnotations)
                .catch((error) => Alert.alert('Could not delete', String(error.message ?? error)));
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    },
    [annotations, reloadAnnotations, sharePassage],
  );

  // --- Navigation ----------------------------------------------------------
  const goToChapter = useCallback(
    (index: number, offset = 0) => {
      if (index < 0 || index >= chapters.length) return;
      restoreOffsetRef.current = offset;
      setSelection(undefined);
      setChapterIndex(index);
      setTocVisible(false);
    },
    [chapters.length],
  );

  // --- WebView bridge ------------------------------------------------------
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(event.nativeEvent.data) as typeof msg;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'ready':
          if (restoreOffsetRef.current > 0) {
            webviewRef.current?.injectJavaScript(
              `window.__reader.scrollToOffset(${restoreOffsetRef.current});true;`,
            );
          }
          break;
        case 'selection':
          if (msg.clear) {
            setSelection(undefined);
          } else {
            setSelection({
              start: Number(msg.start),
              end: Number(msg.end),
              text: String(msg.text ?? ''),
            });
          }
          break;
        case 'scroll': {
          const offset = Number(msg.offset) || 0;
          restoreOffsetRef.current = offset;
          // Reading moved while TTS was paused → the queue is stale; the
          // next play picks up from here instead of the old sentence.
          if (ttsRef.current && !ttsRef.current.status.playing) ttsStaleRef.current = true;
          setFurthest((prior) => {
            if (
              !prior ||
              chapterIndex > prior.chapterIndex ||
              (chapterIndex === prior.chapterIndex && offset > prior.offset)
            ) {
              return { chapterIndex, offset };
            }
            return prior;
          });
          void persistPosition({ bookId, chapterIndex, offset });
          break;
        }
        case 'pageEdge':
          // Page turn past the chapter boundary → flow into the neighbor,
          // landing on its last page when going backwards.
          if (msg.dir === 'next') goToChapter(chapterIndex + 1);
          else goToChapter(chapterIndex - 1, Number.MAX_SAFE_INTEGER);
          break;
        case 'tapHighlight':
          handleTapHighlight(String(msg.id));
          break;
        case 'tap':
          setChromeVisible((visible) => !visible);
          break;
      }
    },
    [bookId, chapterIndex, goToChapter, handleTapHighlight],
  );

  const turnOrGo = useCallback(
    (delta: number) => {
      if (pagination === 'paged') {
        webviewRef.current?.injectJavaScript(
          `window.__reader && window.__reader.turnPage(${delta});true;`,
        );
      } else {
        goToChapter(chapterIndex + delta, delta < 0 ? Number.MAX_SAFE_INTEGER : 0);
      }
    },
    [chapterIndex, goToChapter, pagination],
  );

  if (!book || !chapter) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.inkSoft }}>Book not found.</Text>
      </View>
    );
  }

  const prevDisabled = pagination === 'scroll' && chapterIndex === 0;
  const nextDisabled = pagination === 'scroll' && chapterIndex >= chapters.length - 1;

  return (
    <View style={[styles.screen, { backgroundColor: panel.bg }]}>
      <WebView
        ref={webviewRef}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={handleMessage}
        menuItems={[]}
        style={styles.webview}
      />

      {chromeVisible ? (
        <View style={[styles.toolbar, dyn.topBar]}>
          <Pressable hitSlop={8} onPress={() => setTocVisible(true)}>
            <Text style={[styles.toolbarButton, dyn.accentText]}>Chapters</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setSettingsVisible(true)}>
            <Text style={[styles.toolbarButton, dyn.accentText]}>Aa</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={ttsVisible ? closeTts : openTts}>
            <Text
              style={[styles.toolbarButton, dyn.accentText, ttsVisible && { color: colors.danger }]}
            >
              {ttsVisible ? 'Stop' : 'Listen'}
            </Text>
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => navigation.navigate('Notes', { bookId, title: book.title })}
          >
            <Text style={[styles.toolbarButton, dyn.accentText]}>Notes</Text>
          </Pressable>
        </View>
      ) : null}

      {chromeVisible ? (
        <View style={[styles.chapterNav, dyn.bottomBar]}>
          <Pressable hitSlop={8} disabled={prevDisabled} onPress={() => turnOrGo(-1)}>
            <Text style={[styles.navArrow, dyn.accentText, prevDisabled && styles.navDisabled]}>
              ‹ Prev
            </Text>
          </Pressable>
          <Text style={[styles.chapterLabel, dyn.mutedText]} numberOfLines={1}>
            {chapterIndex + 1} / {chapters.length} · {chapter.title}
          </Text>
          <Pressable hitSlop={8} disabled={nextDisabled} onPress={() => turnOrGo(1)}>
            <Text style={[styles.navArrow, dyn.accentText, nextDisabled && styles.navDisabled]}>
              Next ›
            </Text>
          </Pressable>
        </View>
      ) : null}

      {furthest && chapterIndex < furthest.chapterIndex ? (
        <Pressable
          style={[styles.resumeChip, dyn.pill]}
          onPress={() => goToChapter(furthest.chapterIndex, furthest.offset)}
        >
          <Text style={[styles.resumeChipText, dyn.accentText]} numberOfLines={1}>
            Resume at {chapters[furthest.chapterIndex]?.title ?? 'furthest point'} →
          </Text>
        </Pressable>
      ) : null}

      {selection ? (
        <View style={[styles.selectionBar, dyn.pill]}>
          {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => (
            <Pressable
              key={color}
              style={[styles.colorDot, { backgroundColor: `rgb(${HIGHLIGHT_COLORS[color]})` }]}
              onPress={() => addHighlight(color)}
            />
          ))}
          <Pressable hitSlop={8} onPress={promptNote}>
            <Text style={[styles.selectionAction, dyn.accentText]}>Note</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => sharePassage(selection.text)}>
            <Text style={[styles.selectionAction, dyn.accentText]}>Share</Text>
          </Pressable>
        </View>
      ) : null}

      {ttsVisible ? (
        <View style={[styles.ttsBar, dyn.pill]}>
          <Pressable hitSlop={10} onPress={() => getTts().previous()}>
            <PlayerIcon kind="prev" color={panel.fg} />
          </Pressable>
          <Pressable hitSlop={10} onPress={toggleTtsPlay}>
            <PlayerIcon kind={ttsPlaying ? 'pause' : 'play'} color={panel.accent} size={11} />
          </Pressable>
          <Pressable hitSlop={10} onPress={() => getTts().next()}>
            <PlayerIcon kind="next" color={panel.fg} />
          </Pressable>
          <Pressable hitSlop={8} onPress={cycleRate}>
            <Text style={[styles.ttsRate, dyn.mutedText]}>
              {ttsRate.toFixed(2).replace(/0$/, '')}×
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={tocVisible} animationType="slide" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setTocVisible(false)}>
          <View style={styles.tocSheet}>
            <Text style={styles.tocTitle}>Chapters</Text>
            <FlatList
              data={chapters}
              keyExtractor={(_, i) => String(i)}
              initialScrollIndex={Math.max(0, chapterIndex - 2)}
              getItemLayout={(_, index) => ({ length: 44, offset: 44 * index, index })}
              renderItem={({ item, index }: { item: Chapter; index: number }) => (
                <Pressable style={styles.tocRow} onPress={() => goToChapter(index)}>
                  <Text
                    style={[styles.tocText, index === chapterIndex && styles.tocActive]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>

      <Modal visible={settingsVisible} animationType="slide" transparent>
        <Pressable style={styles.modalBackdrop} onPress={() => setSettingsVisible(false)}>
          <View style={styles.settingsSheet}>
            <Text style={styles.tocTitle}>Appearance</Text>

            <View style={styles.swatchRow}>
              {THEME_PREVIEWS.map((preview) => (
                <Pressable
                  key={preview.key}
                  style={styles.swatchItem}
                  onPress={() => setTheme(preview.key)}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: preview.bg },
                      theme === preview.key && styles.swatchActive,
                    ]}
                  >
                    <Text style={[styles.swatchLetter, { color: preview.fg }]}>Aa</Text>
                  </View>
                  <Text
                    style={[styles.swatchLabel, theme === preview.key && styles.tocActive]}
                  >
                    {preview.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>Text size</Text>
              <View style={styles.stepper}>
                <Pressable
                  hitSlop={8}
                  onPress={() => setFontSize((s) => Math.max(14, s - 1))}
                >
                  <Text style={styles.stepperButton}>A−</Text>
                </Pressable>
                <Text style={styles.stepperValue}>{fontSize}</Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => setFontSize((s) => Math.min(26, s + 1))}
                >
                  <Text style={styles.stepperButtonLarge}>A+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.settingsRow}>
              <Text style={styles.settingsLabel}>Layout</Text>
              <View style={styles.segment}>
                {(['scroll', 'paged'] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    style={[styles.segmentItem, pagination === mode && styles.segmentActive]}
                    onPress={() => setPagination(mode)}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        pagination === mode && styles.segmentTextActive,
                      ]}
                    >
                      {mode === 'scroll' ? 'Scroll ↕' : 'Pages ⇔'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  toolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingVertical: 10,
    backgroundColor: 'rgba(250, 247, 242, 0.96)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  toolbarButton: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  chapterNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(250, 247, 242, 0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  navArrow: { color: colors.accent, fontWeight: '600' },
  navDisabled: { opacity: 0.3 },
  chapterLabel: { flex: 1, textAlign: 'center', color: colors.inkSoft, fontSize: 12, marginHorizontal: 8 },
  resumeChip: {
    position: 'absolute',
    bottom: 56,
    right: 16,
    maxWidth: '70%',
    backgroundColor: colors.card,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  resumeChipText: { color: colors.accent, fontWeight: '700', fontSize: 12 },
  selectionBar: {
    position: 'absolute',
    bottom: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  colorDot: { width: 22, height: 22, borderRadius: 11 },
  selectionAction: { color: colors.accent, fontWeight: '700' },
  ttsBar: {
    position: 'absolute',
    bottom: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    backgroundColor: colors.card,
    borderRadius: 26,
    paddingHorizontal: 24,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  ttsButton: { fontSize: 20, color: colors.ink },
  ttsButtonMain: { fontSize: 26, color: colors.accent },
  ttsRate: { fontSize: 14, fontWeight: '700', color: colors.inkSoft },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  tocSheet: {
    maxHeight: '65%',
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  tocTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, padding: 16 },
  tocRow: { height: 44, justifyContent: 'center', paddingHorizontal: 16 },
  tocText: { color: colors.ink, fontSize: 15 },
  tocActive: { color: colors.accent, fontWeight: '700' },
  settingsSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 36,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-evenly',
    rowGap: 12,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  swatchItem: { alignItems: 'center', gap: 6, width: 56 },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  swatchActive: { borderWidth: 2, borderColor: colors.accent },
  swatchLetter: { fontSize: 15, fontWeight: '600' },
  swatchLabel: { fontSize: 11, color: colors.inkSoft },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  settingsLabel: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  stepperButton: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  stepperButtonLarge: { color: colors.accent, fontSize: 19, fontWeight: '700' },
  stepperValue: { color: colors.inkSoft, fontSize: 14, minWidth: 24, textAlign: 'center' },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    padding: 3,
  },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: colors.ink },
});
