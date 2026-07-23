import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
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
  updateAnnotationColor,
  updateAnnotationNote,
  type LoadedBook,
} from '../lib/libraryData';
import {
  loadPreferences,
  savePreferences,
  type ReaderPreferences,
} from '../lib/preferences';
import { TtsController } from '../tts/TtsController';
import { resolveVoice, listVoices, QUALITY_LABEL, type VoiceOption } from '../tts/voices';
import { ensureListeningAudioSession } from '../lib/audio';
import { resetClientStore } from '../store/clientStore';
import { BottomSheet } from '../components/BottomSheet';
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

/** Perceived luminance → is this a dark background? Drives status-bar tint. */
function isDarkBg(hex: string): boolean {
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const n = parseInt(h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Panel palette derived from the active reader theme, mirroring the web CSS vars. */
function panelFor(theme: ReaderTheme) {
  const t = READER_THEMES[theme] ?? READER_THEMES.paper;
  return {
    bg: t.bg,
    fg: t.fg,
    muted: withAlpha(t.fg, 0.55),
    faint: withAlpha(t.fg, 0.4),
    border: withAlpha(t.fg, 0.16),
    accent: t.accent,
    dark: isDarkBg(t.bg),
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

/** X glyph as two crossed bars, so it takes the theme color like the transport. */
function CloseIcon({ color, size = 15 }: { color: string; size?: number }) {
  const bar: ViewStyle = {
    position: 'absolute',
    width: size,
    height: 2,
    borderRadius: 1,
    backgroundColor: color,
  };
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

const SHEET_LIST_MAX = Math.round(Dimensions.get('window').height * 0.5);

export function ReaderScreen(props: Props) {
  const { bookId } = props.route.params;
  const [data, setData] = useState<
    { loaded: LoadedBook; preferences: ReaderPreferences } | null | 'error' | undefined
  >(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setData(undefined);
    void Promise.all([loadBook(bookId), loadPreferences()])
      .then(([loaded, preferences]) => {
        if (!cancelled) setData(loaded ? { loaded, preferences } : null);
      })
      // A rejection here (usually a SQLite handle invalidated while the app was
      // backgrounded) must not leave a permanent blank screen: surface it and
      // offer a retry, which reopens the connection via the self-healing driver.
      .catch(() => {
        if (!cancelled) setData('error');
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, attempt]);
  if (data === undefined) return <View style={styles.center} />;
  if (data === 'error') {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.inkSoft, textAlign: 'center', paddingHorizontal: 40 }}>
          Couldn’t open this book — this can happen right after the app returns from the
          background.
        </Text>
        <Pressable
          onPress={() => {
            resetClientStore();
            setAttempt((n) => n + 1);
          }}
          style={{
            marginTop: 18,
            paddingHorizontal: 22,
            paddingVertical: 10,
            borderRadius: 22,
            backgroundColor: colors.accent,
          }}
        >
          <Text style={{ color: colors.bg, fontWeight: '700' }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (data === null) {
    // The book row exists but its content isn't on this device and the
    // on-demand fetch failed (offline or signed-out). Offer a retry — the
    // dead-end with no way back is exactly the state we must never ship.
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.inkSoft, textAlign: 'center', paddingHorizontal: 40 }}>
          This book hasn’t downloaded to this device yet. Check your connection and try again.
        </Text>
        <Pressable
          onPress={() => setAttempt((n) => n + 1)}
          style={{
            marginTop: 18,
            paddingHorizontal: 22,
            paddingVertical: 10,
            borderRadius: 22,
            backgroundColor: colors.accent,
          }}
        >
          <Text style={{ color: colors.bg, fontWeight: '700' }}>Try again</Text>
        </Pressable>
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
  const [ttsVoiceId, setTtsVoiceId] = useState<string | undefined>(preferences.ttsVoice);
  const [voiceSheetVisible, setVoiceSheetVisible] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);

  const webviewRef = useRef<WebView>(null);
  const restoreOffsetRef = useRef(initialPosition?.offset ?? 0);
  const ttsRef = useRef<TtsController | undefined>(undefined);
  const autoAdvanceRef = useRef(false);
  // Guards against a doubled "finished" notification advancing two chapters at
  // once; reset each time a chapter's queue is (re)loaded below.
  const ttsAdvancingRef = useRef(false);
  const ttsStaleRef = useRef(false);
  const voicePromptSeenRef = useRef(preferences.voicePromptSeen ?? false);

  const chapter = chapters[chapterIndex];
  const chapterText = useMemo(() => chapter?.paragraphs.join('\n') ?? '', [chapter]);

  const insets = useSafeAreaInsets();
  const panel = useMemo(() => panelFor(theme), [theme]);
  // Theme-reactive chrome + safe-area padding, applied over the layout styles.
  const dyn = useMemo(
    () => ({
      bar: { backgroundColor: withAlpha(panel.bg, 0.985), borderColor: panel.border },
      topPad: { paddingTop: insets.top + 4 },
      bottomPad: { paddingBottom: insets.bottom + 8 },
      accentText: { color: panel.accent },
      fgText: { color: panel.fg },
      mutedText: { color: panel.muted },
      faintText: { color: panel.faint },
      border: { borderColor: panel.border },
      pill: {
        backgroundColor: panel.bg,
        borderColor: panel.border,
        borderWidth: StyleSheet.hairlineWidth,
        bottom: 84 + insets.bottom,
      },
    }),
    [panel, insets],
  );

  // Chrome fades (fast) in and out rather than snapping.
  const chromeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(chromeAnim, {
      toValue: chromeVisible ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [chromeVisible, chromeAnim]);
  const topBarAnim = {
    opacity: chromeAnim,
    transform: [{ translateY: chromeAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
  };
  const bottomBarAnim = {
    opacity: chromeAnim,
    transform: [{ translateY: chromeAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  };

  // Highlight offsets are relative to *this* chapter's text, so only the
  // current chapter's annotations may be handed to the renderer — otherwise
  // other chapters' ranges land on whatever sits at those offsets here and the
  // page fills with phantom highlights as they accumulate.
  const chapterAnnotations = useMemo(
    () => annotations.filter((a) => a.locator.chapterIndex === chapterIndex),
    [annotations, chapterIndex],
  );

  const html = useMemo(
    () =>
      chapter
        ? buildReaderHtml(chapter, chapterAnnotations, { theme, fontSize, pagination })
        : '',
    [chapter, chapterAnnotations, theme, fontSize, pagination],
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
          restoreOffsetRef.current = 0;
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
      tts.load(chapterText, offset);
      tts.play();
    } else if (ttsVisible) {
      tts.load(chapterText, offset);
    } else {
      tts.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex, chapterText]);

  // Preload installed voices so the Aa › Voice row can name the current pick
  // before Listen is ever opened.
  useEffect(() => {
    void listVoices(book?.language ?? 'en')
      .then(setVoices)
      .catch(() => undefined);
  }, [book?.language]);

  const openTts = useCallback(async () => {
    const tts = getTts();
    const language = book?.language ?? 'en';
    // Claim the playback audio session first, or the first utterance is silenced
    // by the mute switch on a real device.
    await ensureListeningAudioSession();
    const list = await listVoices(language);
    setVoices(list);
    const voice = await resolveVoice(language, ttsVoiceId);
    tts.setVoice(voice?.identifier);
    ttsStaleRef.current = false;
    tts.load(chapterText, restoreOffsetRef.current);
    setTtsVisible(true);
    tts.play();
    // First-run nudge: if only standard voices are installed and the reader
    // hasn't picked one, point them at the free higher-quality downloads. iOS
    // has no public deep-link to the Voices pane, so we open Settings + guide.
    if (!voicePromptSeenRef.current && !ttsVoiceId && list.every((v) => v.quality === 'default')) {
      voicePromptSeenRef.current = true;
      void savePreferences({ voicePromptSeen: true });
      Alert.alert(
        'Nicer reading voices',
        'iOS can read aloud with far more natural voices — a free download. Add one under Settings › Accessibility › Spoken Content › Voices, then choose it here from Aa › Voice.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ],
      );
    }
  }, [book?.language, chapterText, getTts, ttsVoiceId]);

  const openVoiceSheet = useCallback(async () => {
    setVoices(await listVoices(book?.language ?? 'en'));
    setSettingsVisible(false);
    setVoiceSheetVisible(true);
  }, [book?.language]);

  const selectVoice = useCallback(
    (id: string) => {
      setTtsVoiceId(id);
      getTts().setVoice(id);
      void savePreferences({ ttsVoice: id });
      setVoiceSheetVisible(false);
    },
    [getTts],
  );

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

  // Sentence transport that crosses chapter boundaries: at the last line, Next
  // flows into the next chapter's first line (Prev into the previous chapter's
  // last line), routing through the same chapterIndex the auto-advance uses so
  // the page and the spoken line never disagree.
  const ttsNext = useCallback(() => {
    const tts = getTts();
    const { sentenceIndex, totalSentences, playing } = tts.status;
    if (totalSentences > 0 && sentenceIndex >= totalSentences - 1) {
      if (chapterIndex + 1 >= chapters.length) return;
      restoreOffsetRef.current = 0;
      if (playing) autoAdvanceRef.current = true;
      setChapterIndex(chapterIndex + 1);
    } else {
      tts.next();
    }
  }, [getTts, chapterIndex, chapters.length]);

  const ttsPrev = useCallback(() => {
    const tts = getTts();
    const { sentenceIndex, playing } = tts.status;
    if (sentenceIndex <= 0) {
      if (chapterIndex <= 0) return;
      restoreOffsetRef.current = Number.MAX_SAFE_INTEGER;
      if (playing) autoAdvanceRef.current = true;
      setChapterIndex(chapterIndex - 1);
    } else {
      tts.previous();
    }
  }, [getTts, chapterIndex]);

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

  const promptColor = useCallback(
    (annotation: Annotation) => {
      Alert.alert('Highlight color', undefined, [
        ...(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => ({
          text: color[0]!.toUpperCase() + color.slice(1) + (annotation.color === color ? '  ✓' : ''),
          onPress: () => {
            void updateAnnotationColor(annotation.id, color)
              .then(reloadAnnotations)
              .catch((error) => Alert.alert('Could not save', String(error.message ?? error)));
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [reloadAnnotations],
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
          { text: 'Change color', onPress: () => promptColor(annotation) },
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
    [annotations, promptColor, reloadAnnotations, sharePassage],
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
  const currentVoiceName =
    voices.find((v) => v.identifier === ttsVoiceId)?.name ??
    (ttsVoiceId ? 'Selected voice' : 'Automatic');

  return (
    <View style={[styles.screen, { backgroundColor: panel.bg }]}>
      <StatusBar style={panel.dark ? 'light' : 'dark'} />
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <WebView
          ref={webviewRef}
          source={{ html }}
          originWhitelist={['*']}
          onMessage={handleMessage}
          menuItems={[]}
          style={styles.webview}
        />
      </View>

      {/* Top bar: close (X) on the left, actions on the right. Fades with chrome. */}
      <Animated.View
        style={[styles.topBar, dyn.bar, dyn.topPad, topBarAnim]}
        pointerEvents={chromeVisible ? 'auto' : 'none'}
      >
        <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
          <CloseIcon color={panel.fg} />
        </Pressable>
        <View style={styles.topActions}>
          <Pressable hitSlop={8} onPress={() => setTocVisible(true)}>
            <Text style={[styles.toolbarButton, dyn.accentText]}>Chapters</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setSettingsVisible(true)}>
            <Text style={[styles.toolbarButton, dyn.accentText]}>Aa</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={ttsVisible ? closeTts : openTts}>
            <Text style={[styles.toolbarButton, ttsVisible ? { color: colors.danger } : dyn.accentText]}>
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
      </Animated.View>

      {/* Bottom region. Listening → persistent full-width Kobo-style transport;
          otherwise → chapter nav that fades with the chrome. Both carry the
          tiny, muted page/chapter line (Books-style). */}
      {ttsVisible ? (
        <View style={[styles.bottomBar, dyn.bar, dyn.bottomPad]}>
          <Text style={[styles.bottomInfo, dyn.faintText]} numberOfLines={1}>
            {chapter.title} · {chapterIndex + 1} / {chapters.length}
          </Text>
          <View style={styles.ttsRow}>
            <View style={styles.ttsRateBtn} />
            <View style={styles.ttsTransport}>
              <Pressable hitSlop={12} onPress={ttsPrev}>
                <PlayerIcon kind="prev" color={panel.fg} size={10} />
              </Pressable>
              <Pressable hitSlop={14} onPress={toggleTtsPlay}>
                <PlayerIcon kind={ttsPlaying ? 'pause' : 'play'} color={panel.accent} size={14} />
              </Pressable>
              <Pressable hitSlop={12} onPress={ttsNext}>
                <PlayerIcon kind="next" color={panel.fg} size={10} />
              </Pressable>
            </View>
            <Pressable hitSlop={8} onPress={cycleRate} style={styles.ttsRateBtn}>
              <Text style={[styles.ttsRate, dyn.mutedText]}>
                {ttsRate.toFixed(2).replace(/0$/, '')}×
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Animated.View
          style={[styles.bottomBar, dyn.bar, dyn.bottomPad, bottomBarAnim]}
          pointerEvents={chromeVisible ? 'auto' : 'none'}
        >
          <Text style={[styles.bottomInfo, dyn.faintText]} numberOfLines={1}>
            {chapter.title} · {chapterIndex + 1} / {chapters.length}
          </Text>
          <View style={styles.navRow}>
            <Pressable hitSlop={8} disabled={prevDisabled} onPress={() => turnOrGo(-1)}>
              <Text style={[styles.navArrow, dyn.accentText, prevDisabled && styles.navDisabled]}>
                ‹ Prev
              </Text>
            </Pressable>
            <Pressable hitSlop={8} disabled={nextDisabled} onPress={() => turnOrGo(1)}>
              <Text style={[styles.navArrow, dyn.accentText, nextDisabled && styles.navDisabled]}>
                Next ›
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

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

      <BottomSheet visible={tocVisible} onClose={() => setTocVisible(false)} background={panel.bg}>
        <View style={styles.sheetGrip}>
          <View style={[styles.grip, { backgroundColor: panel.border }]} />
        </View>
        <Text style={[styles.sheetTitle, dyn.fgText]}>Chapters</Text>
        {furthest && chapterIndex < furthest.chapterIndex ? (
          <Pressable
            style={styles.tocRow}
            onPress={() => goToChapter(furthest.chapterIndex, furthest.offset)}
          >
            <Text style={[styles.tocText, dyn.accentText, styles.tocActive]} numberOfLines={1}>
              ↩ Go to where I left off
            </Text>
          </Pressable>
        ) : null}
        <FlatList
          data={chapters}
          style={{ maxHeight: SHEET_LIST_MAX }}
          keyExtractor={(_, i) => String(i)}
          initialScrollIndex={Math.max(0, chapterIndex - 2)}
          getItemLayout={(_, index) => ({ length: 44, offset: 44 * index, index })}
          renderItem={({ item, index }: { item: Chapter; index: number }) => (
            <Pressable style={styles.tocRow} onPress={() => goToChapter(index)}>
              <Text
                style={[
                  styles.tocText,
                  index === chapterIndex ? dyn.accentText : dyn.fgText,
                  index === chapterIndex && styles.tocActive,
                ]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
            </Pressable>
          )}
        />
      </BottomSheet>

      <BottomSheet
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        background={panel.bg}
      >
        <View style={styles.sheetGrip}>
          <View style={[styles.grip, { backgroundColor: panel.border }]} />
        </View>
        <Text style={[styles.sheetTitle, dyn.fgText]}>Appearance</Text>

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
                  { backgroundColor: preview.bg, borderColor: panel.border },
                  theme === preview.key && { borderColor: panel.accent, borderWidth: 2 },
                ]}
              >
                <Text style={[styles.swatchLetter, { color: preview.fg }]}>Aa</Text>
              </View>
              <Text
                style={[styles.swatchLabel, theme === preview.key ? dyn.accentText : dyn.mutedText]}
              >
                {preview.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.settingsRow, dyn.border]}>
          <Text style={[styles.settingsLabel, dyn.fgText]}>Text size</Text>
          <View style={styles.stepper}>
            <Pressable hitSlop={8} onPress={() => setFontSize((s) => Math.max(14, s - 1))}>
              <Text style={[styles.stepperButton, dyn.accentText]}>A−</Text>
            </Pressable>
            <Text style={[styles.stepperValue, dyn.mutedText]}>{fontSize}</Text>
            <Pressable hitSlop={8} onPress={() => setFontSize((s) => Math.min(26, s + 1))}>
              <Text style={[styles.stepperButtonLarge, dyn.accentText]}>A+</Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.settingsRow, dyn.border]}>
          <Text style={[styles.settingsLabel, dyn.fgText]}>Layout</Text>
          <View style={[styles.segment, { backgroundColor: withAlpha(panel.fg, 0.08) }]}>
            {(['scroll', 'paged'] as const).map((mode) => (
              <Pressable
                key={mode}
                style={[
                  styles.segmentItem,
                  pagination === mode && {
                    backgroundColor: panel.bg,
                    borderColor: panel.border,
                    borderWidth: StyleSheet.hairlineWidth,
                  },
                ]}
                onPress={() => setPagination(mode)}
              >
                <Text
                  style={[styles.segmentText, pagination === mode ? dyn.fgText : dyn.mutedText]}
                >
                  {mode === 'scroll' ? 'Scroll ↕' : 'Pages ⇔'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable style={[styles.settingsRow, dyn.border]} onPress={openVoiceSheet}>
          <Text style={[styles.settingsLabel, dyn.fgText]}>Voice</Text>
          <View style={styles.voiceValue}>
            <Text style={[styles.voiceValueText, dyn.mutedText]} numberOfLines={1}>
              {currentVoiceName}
            </Text>
            <Text style={[styles.voiceChevron, dyn.faintText]}>›</Text>
          </View>
        </Pressable>
      </BottomSheet>

      <BottomSheet
        visible={voiceSheetVisible}
        onClose={() => setVoiceSheetVisible(false)}
        background={panel.bg}
      >
        <View style={styles.sheetGrip}>
          <View style={[styles.grip, { backgroundColor: panel.border }]} />
        </View>
        <Text style={[styles.sheetTitle, dyn.fgText]}>Voice</Text>
        {voices.every((v) => v.quality === 'default') ? (
          <Pressable
            style={[styles.voiceBanner, { borderColor: panel.border }]}
            onPress={() => void Linking.openSettings()}
          >
            <Text style={[styles.voiceBannerText, dyn.mutedText]}>
              Only standard voices are installed. Add richer ones (free) in Settings ›
              Accessibility › Spoken Content › Voices.
            </Text>
            <Text style={[styles.voiceBannerAction, dyn.accentText]}>Open Settings ›</Text>
          </Pressable>
        ) : null}
        <FlatList
          data={voices}
          style={{ maxHeight: SHEET_LIST_MAX }}
          keyExtractor={(v) => v.identifier}
          renderItem={({ item }: { item: VoiceOption }) => {
            const active = item.identifier === ttsVoiceId;
            return (
              <Pressable style={styles.voiceRow} onPress={() => selectVoice(item.identifier)}>
                <View style={styles.voiceRowMain}>
                  <Text
                    style={[styles.voiceName, active ? dyn.accentText : dyn.fgText]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {item.quality !== 'default' ? (
                    <Text style={[styles.voiceTag, dyn.faintText]}>{QUALITY_LABEL[item.quality]}</Text>
                  ) : null}
                </View>
                {active ? <Text style={[styles.voiceCheck, dyn.accentText]}>✓</Text> : null}
              </Pressable>
            );
          }}
        />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  toolbarButton: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bottomInfo: {
    textAlign: 'center',
    fontSize: 11,
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navArrow: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  navDisabled: { opacity: 0.3 },
  ttsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ttsTransport: { flexDirection: 'row', alignItems: 'center', gap: 40 },
  ttsRateBtn: { width: 52, alignItems: 'flex-end' },
  ttsRate: { fontSize: 14, fontWeight: '700', color: colors.inkSoft },
  resumeChip: {
    position: 'absolute',
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
  sheetGrip: { alignItems: 'center', paddingTop: 8 },
  grip: { width: 36, height: 4, borderRadius: 2, opacity: 0.6 },
  sheetTitle: { fontSize: 17, fontWeight: '700', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },
  tocRow: { height: 44, justifyContent: 'center', paddingHorizontal: 16 },
  tocText: { fontSize: 15 },
  tocActive: { fontWeight: '700' },
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
  },
  swatchLetter: { fontSize: 15, fontWeight: '600' },
  swatchLabel: { fontSize: 11 },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  settingsLabel: { fontSize: 15, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  stepperButton: { fontSize: 15, fontWeight: '700' },
  stepperButtonLarge: { fontSize: 19, fontWeight: '700' },
  stepperValue: { fontSize: 14, minWidth: 24, textAlign: 'center' },
  segment: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  segmentText: { fontSize: 13, fontWeight: '600' },
  voiceValue: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '60%' },
  voiceValueText: { fontSize: 14 },
  voiceChevron: { fontSize: 20, fontWeight: '400' },
  voiceBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  voiceBannerText: { fontSize: 13, lineHeight: 18 },
  voiceBannerAction: { fontSize: 13, fontWeight: '700' },
  voiceRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  voiceRowMain: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  voiceName: { fontSize: 15, flexShrink: 1 },
  voiceTag: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  voiceCheck: { fontSize: 15, fontWeight: '700' },
});
