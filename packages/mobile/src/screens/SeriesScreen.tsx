import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { fetchSeries, readerUrl, type SeriesDetail } from '../lib/discover';
import { colors, tintFor } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Series'>;

/**
 * A published serial's promo page on mobile: the work, its pricing, chapter
 * list, and top-ranked discussion — the "discover it, want to read it" surface.
 * Reading and paying happen in the web reader (opened via a link) for now.
 */
export function SeriesScreen({ route }: Props) {
  const { bookId } = route.params;
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchSeries(bookId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Could not load this series.</Text>
      </View>
    );
  }

  const { series, chapters, comments } = detail;
  const paid = series.coinsPerChapter > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Work header */}
      <View style={styles.header}>
        <View style={[styles.cover, { backgroundColor: tintFor(series.id) }]}>
          <Text style={styles.coverInitials}>{initials(series.title)}</Text>
        </View>
        <View style={styles.headerBody}>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              {series.status === 'completed' ? 'Completed' : 'Ongoing'}
            </Text>
          </View>
          <Text style={styles.title}>{series.title}</Text>
          {series.author ? <Text style={styles.author}>{series.author}</Text> : null}
          <Text style={styles.meta}>
            {series.chapterCount} chapter{series.chapterCount === 1 ? '' : 's'} ·{' '}
            {series.commentCount} comment{series.commentCount === 1 ? '' : 's'}
          </Text>
          {paid ? (
            <Text style={styles.price}>
              {series.freeChapterCount > 0
                ? `First ${series.freeChapterCount} free · ${series.coinsPerChapter} coins each`
                : `${series.coinsPerChapter} coins per chapter`}
            </Text>
          ) : (
            <Text style={styles.freeNote}>Free to read</Text>
          )}
        </View>
      </View>

      <Pressable style={styles.readButton} onPress={() => void Linking.openURL(readerUrl(series.id, 0))}>
        <Text style={styles.readButtonText}>Start reading</Text>
      </Pressable>

      {/* Chapters */}
      <Text style={styles.sectionTitle}>Chapters</Text>
      <View style={styles.chapterList}>
        {chapters.map((chapter) => {
          const chapterPaid = paid && chapter.index >= series.freeChapterCount;
          return (
            <Pressable
              key={chapter.index}
              style={styles.chapterRow}
              onPress={() => void Linking.openURL(readerUrl(series.id, chapter.index))}
            >
              <Text style={styles.chapterNum}>{chapter.index + 1}</Text>
              <Text style={styles.chapterTitle} numberOfLines={1}>
                {chapter.title}
              </Text>
              <Text style={chapterPaid ? styles.chapterPrice : styles.chapterFree}>
                {chapterPaid ? `${series.coinsPerChapter} coins` : 'Free'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Discussion */}
      {comments.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Discussion</Text>
          <View style={styles.chapterList}>
            {comments.slice(0, 5).map((comment) => (
              <View key={comment.id} style={styles.comment}>
                <View style={styles.commentScore}>
                  <Text style={styles.commentScoreText}>{comment.score}</Text>
                </View>
                <View style={styles.commentBody}>
                  <Text style={styles.commentText}>{comment.body}</Text>
                  <Text style={styles.commentMeta}>
                    {comment.authorName || 'Reader'} · Chapter {comment.chapterIndex + 1}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  errorText: { color: colors.inkSoft },
  header: { flexDirection: 'row', gap: 14 },
  cover: {
    width: 96,
    height: 140,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitials: { color: '#fff', fontSize: 28, fontWeight: '700' },
  headerBody: { flex: 1 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    backgroundColor: '#eef4ee',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4a5d4e' },
  statusText: { fontSize: 11, fontWeight: '600', color: '#4a5d4e' },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, marginTop: 8 },
  author: { fontSize: 15, color: colors.inkSoft, marginTop: 2 },
  meta: { fontSize: 13, color: colors.inkSoft, marginTop: 8 },
  price: { fontSize: 13, fontWeight: '600', color: '#b08a5e', marginTop: 6 },
  freeNote: { fontSize: 13, color: '#b8ae9e', marginTop: 6 },
  readButton: {
    marginTop: 20,
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 13,
    alignItems: 'center',
  },
  readButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: 28, marginBottom: 10 },
  chapterList: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chapterNum: { width: 24, fontSize: 13, color: '#a49a8b', textAlign: 'right' },
  chapterTitle: { flex: 1, fontSize: 15, color: colors.ink },
  chapterPrice: { fontSize: 12, fontWeight: '600', color: '#b08a5e' },
  chapterFree: { fontSize: 12, color: '#b8ae9e' },
  comment: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  commentScore: { alignItems: 'center', minWidth: 28 },
  commentScoreText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  commentBody: { flex: 1 },
  commentText: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  commentMeta: { fontSize: 12, color: colors.inkSoft, marginTop: 4 },
});
