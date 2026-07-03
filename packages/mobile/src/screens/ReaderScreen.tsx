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
import { AUTODEMO } from '../dev/autodemo';
import { exportAnnotationsMarkdown } from '@inkread/core';
import { newId } from '../lib/id';
import { buildReaderHtml, HIGHLIGHT_COLORS, type ReaderTheme } from '@inkread/core';
import {
  deleteAnnotation,
  getBook,
  getPosition,
  insertAnnotation,
  listAnnotations,
  savePosition,
  updateAnnotationNote,
} from '../store/db';
import { readChapters } from '../store/files';
import { TtsController, pickBestVoice } from '../tts/TtsController';
import { colors } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Reader'>;

interface Selection {
  start: number;
  end: number;
  text: string;
}

const THEME_CYCLE: ReaderTheme[] = ['light', 'sepia', 'dark'];

export function ReaderScreen({ route, navigation }: Props) {
  const { bookId } = route.params;
  const book = useMemo(() => getBook(bookId), [bookId]);
  const chapters = useMemo<Chapter[]>(() => readChapters(bookId), [bookId]);
  const initialPosition = useMemo(() => getPosition(bookId), [bookId]);

  const [chapterIndex, setChapterIndex] = useState(initialPosition?.chapterIndex ?? 0);
  const [theme, setTheme] = useState<ReaderTheme>('sepia');
  const [fontSize, setFontSize] = useState(18);
  const [annotations, setAnnotations] = useState<Annotation[]>(() =>
    listAnnotations(bookId, initialPosition?.chapterIndex ?? 0),
  );
  const [selection, setSelection] = useState<Selection | undefined>();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [tocVisible, setTocVisible] = useState(false);
  const [ttsVisible, setTtsVisible] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsRate, setTtsRate] = useState(1.0);

  const webviewRef = useRef<WebView>(null);
  const restoreOffsetRef = useRef(initialPosition?.offset ?? 0);
  const ttsRef = useRef<TtsController | undefined>(undefined);
  const autoAdvanceRef = useRef(false);

  const chapter = chapters[chapterIndex];
  const chapterText = useMemo(() => chapter?.paragraphs.join('\n') ?? '', [chapter]);

  const html = useMemo(
    () => (chapter ? buildReaderHtml(chapter, annotations, { theme, fontSize }) : ''),
    [chapter, annotations, theme, fontSize],
  );

  const reloadAnnotations = useCallback(() => {
    setAnnotations(listAnnotations(bookId, chapterIndex));
  }, [bookId, chapterIndex]);

  useEffect(reloadAnnotations, [reloadAnnotations]);

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
      if (status.playing && !status.sentence && tts.finished) {
        // Ran off the end of the chapter → advance and keep reading.
        autoAdvanceRef.current = true;
        setChapterIndex((index) => Math.min(index + 1, chapters.length - 1));
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
    if (autoAdvanceRef.current && chapterIndex < chapters.length) {
      autoAdvanceRef.current = false;
      tts.load(chapterText, 0);
      tts.play();
    } else if (ttsVisible) {
      tts.load(chapterText, restoreOffsetRef.current);
    } else {
      tts.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex, chapterText]);

  const openTts = useCallback(async () => {
    const tts = getTts();
    const voice = await pickBestVoice(book?.language ?? 'en');
    tts.setVoice(voice?.identifier);
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

  const cycleRate = useCallback(() => {
    const rates = [0.9, 1.0, 1.15, 1.3, 1.5];
    const next = rates[(rates.indexOf(ttsRate) + 1) % rates.length]!;
    setTtsRate(next);
    getTts().setRate(next);
  }, [getTts, ttsRate]);

  // --- Annotations ---------------------------------------------------------
  const addHighlight = useCallback(
    (color: HighlightColor, note?: string) => {
      if (!selection || !chapter) return;
      insertAnnotation({
        id: newId('ann'),
        bookId,
        kind: note ? 'note' : 'highlight',
        locator: { chapterIndex, start: selection.start, end: selection.end },
        passage: selection.text,
        note,
        color,
        chapterTitle: chapter.title,
        createdAt: new Date().toISOString(),
      });
      setSelection(undefined);
      reloadAnnotations();
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
                  updateAnnotationNote(id, note.trim() || undefined);
                  reloadAnnotations();
                }
              }, 'plain-text', annotation.note),
          },
          { text: 'Share', onPress: () => sharePassage(annotation.passage, annotation.note) },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              deleteAnnotation(id);
              reloadAnnotations();
            },
          },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    },
    [annotations, reloadAnnotations, sharePassage],
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
          savePosition({
            bookId,
            chapterIndex,
            offset,
            updatedAt: new Date().toISOString(),
          });
          break;
        }
        case 'tapHighlight':
          handleTapHighlight(String(msg.id));
          break;
        case 'tap':
          setChromeVisible((visible) => !visible);
          break;
      }
    },
    [bookId, chapterIndex, handleTapHighlight],
  );

  const autodemoRan = useRef(false);
  useEffect(() => {
    if (!__DEV__ || !AUTODEMO || autodemoRan.current || !book || !chapter) return;
    autodemoRan.current = true;
    const timer = setTimeout(() => {
      const end = Math.max(chapterText.indexOf('.') + 1, 40);
      console.log('[autodemo] inserting highlight + note on first sentence');
      insertAnnotation({
        id: newId('ann'),
        bookId,
        kind: 'note',
        locator: { chapterIndex, start: 0, end },
        passage: chapterText.slice(0, end),
        note: 'Autodemo: what a great opening.',
        color: 'green',
        chapterTitle: chapter.title,
        createdAt: new Date().toISOString(),
      });
      reloadAnnotations();
      console.log(
        '[autodemo] markdown export:\n' +
          exportAnnotationsMarkdown(book, listAnnotations(bookId)),
      );
      setTimeout(() => {
        console.log('[autodemo] starting TTS');
        void openTts();
        setTimeout(() => {
          console.log('[autodemo] stopping TTS');
          closeTts();
          console.log('[autodemo] COMPLETE');
        }, 12000);
      }, 2000);
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter]);

  const goToChapter = useCallback((index: number) => {
    restoreOffsetRef.current = 0;
    setSelection(undefined);
    setChapterIndex(index);
    setTocVisible(false);
  }, []);

  if (!book || !chapter) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.inkSoft }}>Book not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <WebView
        ref={webviewRef}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={handleMessage}
        menuItems={[]}
        style={styles.webview}
      />

      {chromeVisible ? (
        <View style={styles.toolbar}>
          <Pressable hitSlop={8} onPress={() => setTocVisible(true)}>
            <Text style={styles.toolbarButton}>Chapters</Text>
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % 3]!)}
          >
            <Text style={styles.toolbarButton}>Theme</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setFontSize((s) => Math.max(14, s - 1))}>
            <Text style={styles.toolbarButton}>A-</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setFontSize((s) => Math.min(26, s + 1))}>
            <Text style={styles.toolbarButton}>A+</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={ttsVisible ? closeTts : openTts}>
            <Text style={[styles.toolbarButton, ttsVisible && { color: colors.danger }]}>
              {ttsVisible ? 'Stop' : 'Listen'}
            </Text>
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => navigation.navigate('Notes', { bookId, title: book.title })}
          >
            <Text style={styles.toolbarButton}>Notes</Text>
          </Pressable>
        </View>
      ) : null}

      {chromeVisible ? (
        <View style={styles.chapterNav}>
          <Pressable
            hitSlop={8}
            disabled={chapterIndex === 0}
            onPress={() => goToChapter(chapterIndex - 1)}
          >
            <Text style={[styles.navArrow, chapterIndex === 0 && styles.navDisabled]}>‹ Prev</Text>
          </Pressable>
          <Text style={styles.chapterLabel} numberOfLines={1}>
            {chapterIndex + 1} / {chapters.length} · {chapter.title}
          </Text>
          <Pressable
            hitSlop={8}
            disabled={chapterIndex >= chapters.length - 1}
            onPress={() => goToChapter(chapterIndex + 1)}
          >
            <Text
              style={[
                styles.navArrow,
                chapterIndex >= chapters.length - 1 && styles.navDisabled,
              ]}
            >
              Next ›
            </Text>
          </Pressable>
        </View>
      ) : null}

      {selection ? (
        <View style={styles.selectionBar}>
          {(Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).map((color) => (
            <Pressable
              key={color}
              style={[styles.colorDot, { backgroundColor: `rgb(${HIGHLIGHT_COLORS[color]})` }]}
              onPress={() => addHighlight(color)}
            />
          ))}
          <Pressable hitSlop={8} onPress={promptNote}>
            <Text style={styles.selectionAction}>Note</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => sharePassage(selection.text)}>
            <Text style={styles.selectionAction}>Share</Text>
          </Pressable>
        </View>
      ) : null}

      {ttsVisible ? (
        <View style={styles.ttsBar}>
          <Pressable hitSlop={8} onPress={() => getTts().previous()}>
            <Text style={styles.ttsButton}>⏮</Text>
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() => (ttsPlaying ? getTts().stop() : getTts().play())}
          >
            <Text style={styles.ttsButtonMain}>{ttsPlaying ? '⏸' : '▶'}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => getTts().next()}>
            <Text style={styles.ttsButton}>⏭</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={cycleRate}>
            <Text style={styles.ttsRate}>{ttsRate.toFixed(2).replace(/0$/, '')}×</Text>
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
              renderItem={({ item, index }) => (
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
  tocRow: { paddingHorizontal: 16, paddingVertical: 12 },
  tocText: { color: colors.ink, fontSize: 15 },
  tocActive: { color: colors.accent, fontWeight: '700' },
});
