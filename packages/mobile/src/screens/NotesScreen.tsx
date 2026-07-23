import { useCallback, useEffect, useMemo, useState } from 'react';
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
  exportAnnotationsCsv,
  exportAnnotationsMarkdown,
  formatPassageShare,
  type Annotation,
} from '@inkread/core';
import type { RootStackParamList } from '../navigation';
import { buildEpub } from '@inkread/core';
import { File, Paths } from 'expo-file-system';
import type { CachedBook } from '@inkread/client-store';
import { getClientStore } from '../store/clientStore';
import { deleteAnnotation, refreshAnnotations } from '../lib/libraryData';
import { colors } from '../ui/theme';
import { HIGHLIGHT_COLORS } from '@inkread/core';

type Props = NativeStackScreenProps<RootStackParamList, 'Notes'>;

interface NoteSection {
  title: string;
  data: Annotation[];
}

export function NotesScreen({ route }: Props) {
  const { bookId } = route.params;
  const [book, setBook] = useState<CachedBook>();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  useEffect(() => {
    void getClientStore().then(async (store) => {
      setBook(await store.getBook(bookId));
      setAnnotations(await store.listAnnotations(bookId));
      void refreshAnnotations(bookId).then(setAnnotations);
    });
  }, [bookId]);

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

  const exportAs = useCallback(
    async (format: 'markdown' | 'csv') => {
      if (!book) return;
      const isCsv = format === 'csv';
      const content = isCsv
        ? exportAnnotationsCsv(book, annotations)
        : exportAnnotationsMarkdown(book, annotations);
      const safeName = book.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'notes';
      const file = new File(Paths.cache, `${safeName}.${isCsv ? 'csv' : 'md'}`);
      if (file.exists) file.delete();
      file.write(content);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(
          file.uri,
          isCsv
            ? { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' }
            : { mimeType: 'text/markdown', UTI: 'net.daringfireball.markdown' },
        );
      } else {
        await Share.share({ message: content });
      }
    },
    [annotations, book],
  );

  const chooseExport = useCallback(() => {
    Alert.alert('Export notes', 'Choose a format', [
      { text: 'Markdown — paste into Notion', onPress: () => void exportAs('markdown') },
      { text: 'CSV — Notion database or Sheets', onPress: () => void exportAs('csv') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [exportAs]);

  const shareEpub = useCallback(async () => {
    if (!book) return;
    const store = await getClientStore();
    const chapters = await store.getChapters(bookId);
    if (chapters.length === 0) {
      Alert.alert('No content', 'This book has no cached chapters yet.');
      return;
    }
    const epub = buildEpub({
      title: book.title,
      author: book.author,
      language: book.language,
      identifier: `urn:inkread:${book.id}`,
      modified: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      chapters,
    });
    const safeName = book.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'book';
    const file = new File(Paths.cache, `${safeName}.epub`);
    if (file.exists) file.delete();
    file.write(epub);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'application/epub+zip', UTI: 'org.idpf.epub-container' });
    }
  }, [book, bookId]);

  const handleLongPress = useCallback(
    (annotation: Annotation) => {
      Alert.alert('Remove annotation?', annotation.passage.slice(0, 140), [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void deleteAnnotation(annotation.id)
              .then(() => refreshAnnotations(bookId))
              .then(setAnnotations)
              .catch((error) => Alert.alert('Could not delete', String(error.message ?? error)));
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
        <Pressable style={styles.footerButton} onPress={chooseExport}>
          <Text style={styles.footerButtonText}>Export</Text>
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
