import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import { fetchDiscover, type DiscoverSeries } from '../lib/discover';
import { colors, tintFor } from '../ui/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Discover'>;

/**
 * Browse the serials being published — the mobile discovery/promotion surface.
 * Reads the public discovery API (no session needed); tapping a serial opens its
 * promo page. Reading/paying stays on the web for now.
 */
export function DiscoverScreen({ navigation }: Props) {
  const [series, setSeries] = useState<DiscoverSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q?: string) => {
    try {
      setError(null);
      setSeries(await fetchDiscover(q));
    } catch {
      setError('Could not load serials. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const renderItem = useCallback(
    ({ item }: { item: DiscoverSeries }) => {
      const paid = item.coinsPerChapter > 0;
      return (
        <Pressable
          style={styles.card}
          onPress={() => navigation.navigate('Series', { bookId: item.id, title: item.title })}
        >
          <View style={[styles.cover, { backgroundColor: tintFor(item.id) }]}>
            <Text style={styles.coverInitials}>{initials(item.title)}</Text>
          </View>
          <View style={styles.cardBody}>
            <View style={styles.badgeRow}>
              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>
                  {item.status === 'completed' ? 'Completed' : 'Ongoing'}
                </Text>
              </View>
              {paid ? (
                <Text style={styles.price}>
                  {item.freeChapterCount > 0
                    ? `${item.freeChapterCount} free · ${item.coinsPerChapter}/ch`
                    : `${item.coinsPerChapter} coins/ch`}
                </Text>
              ) : (
                <Text style={styles.free}>Free</Text>
              )}
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            {item.author ? <Text style={styles.author}>{item.author}</Text> : null}
            <Text style={styles.meta}>
              {item.chapterCount} chapter{item.chapterCount === 1 ? '' : 's'}
              {item.commentCount > 0
                ? ` · ${item.commentCount} comment${item.commentCount === 1 ? '' : 's'}`
                : ''}
            </Text>
          </View>
        </Pressable>
      );
    },
    [navigation],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={series}
        keyExtractor={(s) => s.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(query);
            }}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void load(query)}
            placeholder="Search by title or author…"
            placeholderTextColor={colors.inkSoft}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{error ? 'Something went wrong' : 'Nothing here yet'}</Text>
            <Text style={styles.emptyText}>
              {error ?? 'No serials match. Try another search, or check back soon.'}
            </Text>
          </View>
        }
      />
    </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { padding: 16, paddingBottom: 32 },
  search: {
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 14,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cover: { width: 64, alignItems: 'center', justifyContent: 'center' },
  coverInitials: { color: '#fff', fontSize: 20, fontWeight: '700' },
  cardBody: { flex: 1, padding: 14 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#eef4ee',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4a5d4e' },
  statusText: { fontSize: 11, fontWeight: '600', color: '#4a5d4e' },
  price: { fontSize: 12, fontWeight: '600', color: '#b08a5e' },
  free: { fontSize: 12, color: '#b8ae9e' },
  title: { fontSize: 17, fontWeight: '600', color: colors.ink, marginTop: 8 },
  author: { fontSize: 14, color: colors.inkSoft, marginTop: 2 },
  meta: { fontSize: 12, color: colors.inkSoft, marginTop: 8 },
  empty: { alignItems: 'center', marginTop: 100, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 19, fontWeight: '600', color: colors.ink },
  emptyText: { marginTop: 8, textAlign: 'center', color: colors.inkSoft, lineHeight: 20 },
});
