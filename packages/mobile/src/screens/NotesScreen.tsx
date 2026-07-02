import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  SectionList,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Sharing from 'expo-sharing';
import {
  exportAnnotationsMarkdown,
  formatPassageShare,
  type Annotation,
} from '@inkread/core';
import type { RootStackParamList } from '../navigation';
import { deleteAnnotation, getBook, listAnnotations } from '../store/db';
import { epubFile, writeShareFile } from '../store/files';
import { colors } from '../ui/theme';
import { HIGHLIGHT_COLORS } from '../reader/readerHtml';

type Props = NativeStackScreenProps<RootStackParamList, 'Notes'>;

interface NoteSection {
  title: string;
  data: Annotation[];
}

export function NotesScreen({ route }: Props) {
  const { bookId } = route.params;
  const book = useMemo(() => getBook(bookId), [bookId]);
  const [annotations, setAnnotations] = useState<Annotation[]>(() => listAnnotations(bookId));

  const sections = useMemo<NoteSection[]>(() => {
    const byChapter = new Map<number, NoteSection>();
    for (const annotation of annotations) {
      const index = annotation.locator.chapterIndex;
      let section = byChapter.get(index);
      if (!section) {
        section = {
          title: annotation.chapterTitle ?? `Chapter ${index + 1}`,
          data: [],
        };
        byChapter.set(index, section);
      }
      section.data.push(annotation);
    }
    return [...byChapter.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  }, [annotations]);

  const exportMarkdown = useCallback(async () => {
    if (!book) return;
    const markdown = exportAnnotationsMarkdown(book, annotations);
    const safeName = book.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    const file = writeShareFile(`${safeName || 'notes'}.md`, markdown);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', UTI: 'net.daringfireball.markdown' });
    } else {
      await Share.share({ message: markdown });
    }
  }, [annotations, book]);

  const shareEpub = useCallback(async () => {
    const file = epubFile(bookId);
    if (!file.exists) {
      Alert.alert('No EPUB', 'This book has no generated EPUB file.');
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'application/epub+zip', UTI: 'org.idpf.epub-container' });
    }
  }, [bookId]);

  const handleLongPress = useCallback(
    (annotation: Annotation) => {
      Alert.alert('Remove annotation?', annotation.passage.slice(0, 140), [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            deleteAnnotation(annotation.id);
            setAnnotations(listAnnotations(bookId));
          },
        },
      ]);
    },
    [bookId],
  );

  if (!book) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.inkSoft }}>Book not found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onLongPress={() => handleLongPress(item)}
            onPress={() =>
              book && void Share.share({ message: formatPassageShare(book, item.passage, item.note) })
            }
          >
            <View
              style={[
                styles.colorStripe,
                { backgroundColor: `rgb(${HIGHLIGHT_COLORS[item.color] ?? HIGHLIGHT_COLORS['yellow']})` },
              ]}
            />
            <View style={styles.cardBody}>
              <Text style={styles.passage}>“{item.passage}”</Text>
              {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No notes yet</Text>
            <Text style={styles.emptyText}>
              Select any passage while reading to highlight it or attach a note. Everything you
              save shows up here, ready to export.
            </Text>
          </View>
        }
      />
      <View style={styles.footer}>
        <Pressable style={styles.footerButton} onPress={exportMarkdown}>
          <Text style={styles.footerButtonText}>Export Markdown</Text>
        </Pressable>
        <Pressable style={[styles.footerButton, styles.footerSecondary]} onPress={shareEpub}>
          <Text style={[styles.footerButtonText, { color: colors.accent }]}>Share EPUB</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 110 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  colorStripe: { width: 5 },
  cardBody: { flex: 1, padding: 12 },
  passage: { color: colors.ink, fontSize: 15, lineHeight: 21, fontStyle: 'italic' },
  note: { color: colors.inkSoft, marginTop: 8, fontSize: 14, lineHeight: 20 },
  empty: { alignItems: 'center', marginTop: 100, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 19, fontWeight: '600', color: colors.ink },
  emptyText: { marginTop: 8, textAlign: 'center', color: colors.inkSoft, lineHeight: 20 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: 'rgba(250, 247, 242, 0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  footerButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  footerSecondary: { backgroundColor: colors.accentSoft },
  footerButtonText: { color: '#fff', fontWeight: '700' },
});
