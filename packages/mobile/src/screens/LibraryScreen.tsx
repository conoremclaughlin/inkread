import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { PdfPage, ReadingPosition } from '@inkread/core';
import type { CachedBook } from '@inkread/client-store';
import type { RootStackParamList } from '../navigation';
import { SAMPLE_PDF_BASE64, SAMPLE_PDF_TITLE } from '../assets/samplePdf';
import { bytesToBase64 } from '../lib/base64';
import { apiFetch } from '../lib/api';
import { syncNow } from '../lib/sync';
import { finishConversion } from '../convert/convertPdf';
import { PdfExtractor, type PdfMeta } from '../pdf/PdfExtractor';
import { getClientStore } from '../store/clientStore';
import { colors, tintFor } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Library'>;

/**
 * A filled cloud silhouette drawn from overlapping views (like the reader's
 * transport glyphs) so it takes the theme color and never renders as an emoji.
 * Shown on library cards whose content lives only in the cloud, not on-device.
 */
function CloudIcon({ color, size = 13 }: { color: string; size?: number }) {
  const w = size * 1.6;
  const puff = (style: ViewStyle): ViewStyle => ({
    position: 'absolute',
    backgroundColor: color,
    ...style,
  });
  return (
    <View style={{ width: w, height: size }}>
      <View
        style={puff({
          bottom: 0,
          left: 0,
          width: w,
          height: size * 0.52,
          borderRadius: size * 0.26,
        })}
      />
      <View
        style={puff({
          bottom: size * 0.14,
          left: w * 0.06,
          width: size * 0.56,
          height: size * 0.56,
          borderRadius: size * 0.28,
        })}
      />
      <View
        style={puff({
          bottom: size * 0.24,
          left: w * 0.32,
          width: size * 0.76,
          height: size * 0.76,
          borderRadius: size * 0.38,
        })}
      />
      <View
        style={puff({
          bottom: size * 0.14,
          right: w * 0.06,
          width: size * 0.5,
          height: size * 0.5,
          borderRadius: size * 0.25,
        })}
      />
    </View>
  );
}

interface ImportJob {
  pdfBase64: string;
  fileName: string;
  pagesDone: number;
  pageCount: number;
}

export function LibraryScreen({ navigation }: Props) {
  const [books, setBooks] = useState<CachedBook[]>([]);
  const [positions, setPositions] = useState<Map<string, ReadingPosition>>(new Map());
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [job, setJob] = useState<ImportJob | undefined>();

  const reload = useCallback(() => {
    void (async () => {
      const store = await getClientStore();
      const list = await store.listBooks();
      // Resolve local-content presence before setting state so books and their
      // download status render together — otherwise the first paint shows every
      // card as cloud-only until the set arrives, flashing icons on books that
      // are actually on-device.
      const local = await store.downloadedBookIds();
      setBooks(list);
      setDownloaded(local);
      const entries = await Promise.all(
        list.map(async (book): Promise<[string, ReadingPosition | undefined]> => [
          book.id,
          await store.getPosition(book.id),
        ]),
      );
      setPositions(new Map(entries.filter((e): e is [string, ReadingPosition] => !!e[1])));
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      void syncNow()
        .then(reload)
        .catch(() => undefined);
    }, [reload]),
  );

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
        fileName: asset.name.replace(/\.pdf$/i, ''),
        pagesDone: 0,
        pageCount: 0,
      });
    } catch (error) {
      Alert.alert('Import failed', String(error instanceof Error ? error.message : error));
    }
  }, []);

  const startSampleImport = useCallback(() => {
    setJob({
      pdfBase64: SAMPLE_PDF_BASE64,
      fileName: SAMPLE_PDF_TITLE,
      pagesDone: 0,
      pageCount: 0,
    });
  }, []);

  const handleDone = useCallback(
    (pages: PdfPage[], meta: PdfMeta) => {
      const current = job;
      setJob(undefined);
      if (!current) return;
      void finishConversion(pages, meta, current.fileName)
        .then(({ bookId, title }) => {
          reload();
          navigation.navigate('Reader', { bookId, title });
        })
        .catch((error) => {
          Alert.alert('Conversion failed', String(error instanceof Error ? error.message : error));
        });
    },
    [job, navigation, reload],
  );

  const confirmDelete = useCallback(
    (book: CachedBook) => {
      Alert.alert('Delete book', `Remove “${book.title}” and all its notes? There is no undo.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void apiFetch(`/api/books/${book.id}`, { method: 'DELETE' })
              .then(() => syncNow(true))
              .then(reload)
              .catch(() => Alert.alert('Delete failed', 'Check your connection and try again.'));
          },
        },
      ]);
    },
    [reload],
  );

  const renderBook = useCallback(
    ({ item }: { item: CachedBook }) => {
      const position = positions.get(item.id);
      const marker = position?.furthest ?? position;
      const progress = marker
        ? Math.round(((marker.chapterIndex + 1) / Math.max(1, item.chapterCount)) * 100)
        : 0;
      const isLocal = downloaded.has(item.id);
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
            <View style={styles.metaRow}>
              {isLocal ? null : <CloudIcon color={colors.inkSoft} />}
              <Text style={styles.meta}>
                {item.chapterCount} chapters{progress > 0 ? ` · ${progress}% read` : ''}
                {isLocal ? '' : ' · in cloud'}
              </Text>
            </View>
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
    [confirmDelete, downloaded, navigation, positions],
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
              listen to, and annotate — synced across your devices.
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
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  meta: { fontSize: 12, color: colors.inkSoft },
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
