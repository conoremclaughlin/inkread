import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ReadChapter } from '@inkread/core';

/**
 * Public, unauthenticated reads for the discovery site.
 *
 * These use the anon key with NO session, so every query runs as the Postgres
 * `anon` role and only the "public book" RLS policies apply — a private library
 * is invisible here. Kept separate from `LibraryRepository` (which always needs
 * a signed-in user) so pages can render for anonymous visitors.
 */

export interface PublicSeries {
  id: string;
  title: string;
  author?: string;
  chapterCount: number;
  /** Last time the work changed (a new chapter bumps this). */
  updatedAt: string;
  status: 'ongoing' | 'completed';
  commentCount: number;
  /** Chapters free at the start; the rest cost `coinsPerChapter` each. */
  freeChapterCount: number;
  coinsPerChapter: number;
}

export interface PublicComment {
  id: string;
  bookId: string;
  chapterIndex: number;
  authorName?: string;
  body: string;
  createdAt: string;
  score: number;
  upvotes: number;
  downvotes: number;
  /** Title of the series this comment belongs to (for cross-series feeds). */
  seriesTitle: string;
}

interface PublicBookRow {
  id: string;
  title: string;
  author: string | null;
  chapter_count: number;
  updated_at: string;
  status: string;
  free_chapter_count: number | null;
  coins_per_chapter: number | null;
}

interface PublicCommentRow {
  id: string;
  book_id: string;
  chapter_index: number;
  author_name: string | null;
  body: string;
  created_at: string;
  score: number | null;
  up_count: number | null;
  down_count: number | null;
}

let cached: SupabaseClient | undefined;

/** A sessionless anon client — reads run as the `anon` role under public RLS. */
function publicClient(): SupabaseClient {
  cached ??= createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cached;
}

function rowToSeries(row: PublicBookRow, commentCount: number): PublicSeries {
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? undefined,
    chapterCount: row.chapter_count,
    updatedAt: row.updated_at,
    status: row.status === 'completed' ? 'completed' : 'ongoing',
    commentCount,
    freeChapterCount: row.free_chapter_count ?? 0,
    coinsPerChapter: row.coins_per_chapter ?? 0,
  };
}

function rowToComment(row: PublicCommentRow, seriesTitle: string): PublicComment {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterIndex: row.chapter_index,
    authorName: row.author_name ?? undefined,
    body: row.body,
    createdAt: row.created_at,
    score: row.score ?? 0,
    upvotes: row.up_count ?? 0,
    downvotes: row.down_count ?? 0,
    seriesTitle,
  };
}

/** Count comments per book id in one query (keeps card counts cheap-ish). */
async function commentCounts(bookIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (bookIds.length === 0) return counts;
  const { data } = await publicClient()
    .from('comments')
    .select('book_id')
    .in('book_id', bookIds);
  for (const row of (data ?? []) as { book_id: string }[]) {
    counts.set(row.book_id, (counts.get(row.book_id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Actively-published series for the home grid: public + ongoing, freshest
 * (most recently updated) first.
 */
export async function listActiveSeries(): Promise<PublicSeries[]> {
  const { data, error } = await publicClient()
    .from('books')
    .select('id, title, author, chapter_count, updated_at, status, free_chapter_count, coins_per_chapter')
    .eq('visibility', 'public')
    .eq('status', 'ongoing')
    .order('updated_at', { ascending: false });
  if (error || !data) return [];
  const rows = data as PublicBookRow[];
  const counts = await commentCounts(rows.map((r) => r.id));
  return rows.map((row) => rowToSeries(row, counts.get(row.id) ?? 0));
}

/**
 * The liveliest reader comments across every public series, highest score
 * first — the "what readers are saying" feed at the bottom of the home page.
 */
export async function listTopPublicComments(limit = 8): Promise<PublicComment[]> {
  const { data, error } = await publicClient()
    .from('comments')
    .select(
      'id, book_id, chapter_index, author_name, body, created_at, score, up_count, down_count, books!inner(title, visibility)',
    )
    .eq('books.visibility', 'public')
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  // supabase-js types the embedded relation as an array; at runtime a
  // many-to-one embed is a single object (or array in some versions) — handle both.
  const rows = data as unknown as (PublicCommentRow & {
    books: { title: string } | { title: string }[] | null;
  })[];
  return rows.map((row) => {
    const book = Array.isArray(row.books) ? row.books[0] : row.books;
    return rowToComment(row, book?.title ?? '');
  });
}

export interface PublicSeriesDetail {
  series: PublicSeries;
  chapters: { index: number; title: string }[];
  comments: PublicComment[];
}

/** A single public series with its chapter list and score-sorted discussion. */
export async function getPublicSeries(bookId: string): Promise<PublicSeriesDetail | undefined> {
  const client = publicClient();
  const { data: bookData, error } = await client
    .from('books')
    .select('id, title, author, chapter_count, updated_at, status, free_chapter_count, coins_per_chapter')
    .eq('id', bookId)
    .eq('visibility', 'public')
    .maybeSingle();
  if (error || !bookData) return undefined;
  const book = bookData as PublicBookRow;

  const [{ data: chapterData }, { data: commentData }] = await Promise.all([
    // The full TOC (index + title for free AND paid chapters) comes via a
    // definer RPC — the chapters table itself only exposes free-chapter rows.
    client.rpc('public_series_toc', { p_book_id: bookId }),
    client
      .from('comments')
      .select('id, book_id, chapter_index, author_name, body, created_at, score, up_count, down_count')
      .eq('book_id', bookId)
      .order('score', { ascending: false })
      .order('created_at', { ascending: false }),
  ]);

  const chapters = ((chapterData ?? []) as { chapter_index: number; title: string }[]).map((c) => ({
    index: c.chapter_index,
    title: c.title,
  }));
  const comments = ((commentData ?? []) as PublicCommentRow[]).map((row) =>
    rowToComment(row, book.title),
  );

  return { series: rowToSeries(book, comments.length), chapters, comments };
}

interface ReadChapterRow {
  chapter_index: number;
  title: string;
  paragraphs: string[] | null;
  locked: boolean;
  coin_cost: number;
}

/**
 * A single chapter for an anonymous visitor, through the entitlement gate. With
 * no session, only the free head returns a body; paid chapters come back
 * `locked` (the client then prompts sign-in to unlock). A signed-in reader gets
 * their unlocks honored via the authenticated repository's `readChapter`.
 */
export async function getPublicChapter(
  bookId: string,
  chapterIndex: number,
): Promise<ReadChapter | undefined> {
  const { data, error } = await publicClient()
    .rpc('read_public_chapter', { p_book_id: bookId, p_chapter_index: chapterIndex })
    .maybeSingle();
  if (error || !data) return undefined;
  const row = data as ReadChapterRow;
  return {
    chapterIndex: row.chapter_index,
    title: row.title,
    paragraphs: row.paragraphs ?? undefined,
    locked: row.locked,
    coinCost: row.coin_cost,
  };
}
