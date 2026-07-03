import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import type { PdfPage } from '@inkread/core';
import type { RootStackParamList } from '../navigation';
import { SAMPLE_PDF_BASE64, SAMPLE_PDF_TITLE } from '../assets/samplePdf';
import { AUTODEMO } from '../dev/autodemo';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { finishConversion } from '../convert/convertPdf';
import { PdfExtractor, type PdfMeta } from '../pdf/PdfExtractor';
import { deleteBook, getPosition, listBooks, type BookRecord } from '../store/db';
import { deleteBookFiles } from '../store/files';
import { colors, tintFor } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

interface ImportJob {
  pdfBase64: string;
  sourceUri: string;
  fileName: string;
  pagesDone: number;
  pageCount: number;
}

export function LibraryScreen({ navigation }: Props) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [job, setJob] = useState<ImportJob | undefined>();

  const reload = useCallback(() => setBooks(listBooks()), []);
  useFocusEffect(reload);

  const startImport = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    try {
      const bytes = new File(asset.uri).bytesSync();
      setJob({
        pdfBase64: bytesToBase64(bytes),
        sourceUri: asset.uri,
        fileName: asset.name.replace(/\.pdf$/i, ''),
        pagesDone: 0,
        pageCount: 0,
      });
    } catch (error) {
      Alert.alert('Import failed', String(error instanceof Error ? error.message : error));
    }
  }, []);

  const startSampleImport = useCallback(() => {
    const file = new File(Paths.cache, 'sample-book.pdf');
    file.write(base64ToBytes(SAMPLE_PDF_BASE64));
    setJob({
      pdfBase64: SAMPLE_PDF_BASE64,
      sourceUri: file.uri,
      fileName: SAMPLE_PDF_TITLE,
      pagesDone: 0,
      pageCount: 0,
    });
  }, []);

  const autodemoRan = useRef(false);
  useEffect(() => {
    if (__DEV__ && AUTODEMO && !autodemoRan.current && listBooks().length === 0) {
      autodemoRan.current = true;
      console.log('[autodemo] importing sample book');
      startSampleImport();
    }
  }, [startSampleImport]);

  const handleDone = useCallback(
    (pages: PdfPage[], meta: PdfMeta) => {
      const current = job;
      setJob(undefined);
      if (!current) return;
      try {
        const { book } = finishConversion(pages, meta, current.fileName, current.sourceUri);
        reload();
        navigation.navigate('Reader', { bookId: book.id, title: book.title });
      } catch (error) {
        Alert.alert('Conversion failed', String(error instanceof Error ? error.message : error));
      }
    },
    [job, navigation, reload],
  );

  const confirmDelete = useCallback(
    (book: BookRecord) => {
      Alert.alert('Delete book', `Remove “${book.title}” and all its notes?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteBook(book.id);
            deleteBookFiles(book.id);
            reload();
          },
        },
      ]);
    },
    [reload],
  );

  const renderBook = useCallback(
    ({ item }: { item: BookRecord }) => {
      const position = getPosition(item.id);
      const progress = position
        ? Math.round(((position.chapterIndex + 1) / Math.max(1, item.chapterCount)) * 100)
        : 0;
      return (
        <Pressable
          style={styles.card}
          onPress={() => navigation.navigate('Reader', { bookId: item.id, title: item.title })}
          onLongPress={() => confirmDelete(item)}
        >
          <View style={[styles.spine, { backgroundColor: tintFor(item.id) }]} />
          <View style={styles.cardBody}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            {item.author ? <Text style={styles.author}>{item.author}</Text> : null}
            <Text style={styles.meta}>
              {item.chapterCount} chapters{progress > 0 ? ` · ${progress}%` : ''}
            </Text>
          </View>
          <Pressable
            hitSlop={12}
            style={styles.notesButton}
            onPress={() => navigation.navigate('Notes', { bookId: item.id, title: item.title })}
          >
            <Text style={styles.notesButtonText}>Notes</Text>
          </Pressable>
        </Pressable>
      );
    },
    [confirmDelete, navigation],
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={books}
        keyExtractor={(book) => book.id}
        renderItem={renderBook}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Your library is empty</Text>
            <Text style={styles.emptyText}>
              Import a PDF and inkread will convert it into a clean, reflowable book you can read,
              listen to, and annotate.
            </Text>
            <Pressable style={styles.sampleButton} onPress={startSampleImport} disabled={!!job}>
              <Text style={styles.sampleButtonText}>Try a sample book</Text>
            </Pressable>
          </View>
        }
      />
      <Pressable style={styles.fab} onPress={startImport} disabled={!!job}>
        <Text style={styles.fabText}>{job ? '…' : '+ Import PDF'}</Text>
      </Pressable>

      {job ? (
        <View style={styles.overlay}>
          <View style={styles.progressCard}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.progressTitle}>Converting “{job.fileName}”</Text>
            <Text style={styles.progressText}>
              {job.pageCount > 0
                ? `Extracting page ${job.pagesDone} of ${job.pageCount}`
                : 'Opening PDF…'}
            </Text>
          </View>
          <PdfExtractor
            pdfBase64={job.pdfBase64}
            onMeta={(meta) => setJob((j) => (j ? { ...j, pageCount: meta.pageCount } : j))}
            onPage={() => setJob((j) => (j ? { ...j, pagesDone: j.pagesDone + 1 } : j))}
            onDone={handleDone}
            onError={(message) => {
              setJob(undefined);
              Alert.alert('Could not read PDF', message);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { padding: 16, paddingBottom: 96 },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  spine: { width: 6 },
  cardBody: { flex: 1, padding: 14 },
  title: { fontSize: 17, fontWeight: '600', color: colors.ink },
  author: { fontSize: 14, color: colors.inkSoft, marginTop: 2 },
  meta: { fontSize: 12, color: colors.inkSoft, marginTop: 8 },
  notesButton: { justifyContent: 'center', paddingHorizontal: 14 },
  notesButtonText: { color: colors.accent, fontWeight: '600' },
  empty: { alignItems: 'center', marginTop: 120, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: colors.ink },
  emptyText: { marginTop: 8, textAlign: 'center', color: colors.inkSoft, lineHeight: 20 },
  sampleButton: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  sampleButtonText: { color: colors.accent, fontWeight: '600' },
  fab: {
    position: 'absolute',
    bottom: 28,
    alignSelf: 'center',
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 13,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    width: 280,
  },
  progressTitle: { marginTop: 12, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  progressText: { marginTop: 6, color: colors.inkSoft, fontSize: 13 },
});
