import { API_URL } from './api';

/**
 * Public discovery reads — unauthenticated, so no Bearer token (unlike
 * `apiFetch`). These hit the web app's public discovery API, which runs as the
 * anon role under public RLS. Used by the Discover/Series promotion screens.
 */

export interface DiscoverSeries {
  id: string;
  title: string;
  author?: string;
  chapterCount: number;
  updatedAt: string;
  status: 'ongoing' | 'completed';
  commentCount: number;
  freeChapterCount: number;
  coinsPerChapter: number;
}

export interface DiscoverComment {
  id: string;
  chapterIndex: number;
  authorName?: string;
  body: string;
  createdAt: string;
  score: number;
}

export interface SeriesDetail {
  series: DiscoverSeries;
  chapters: { index: number; title: string }[];
  comments: DiscoverComment[];
}

/** Actively-published (or searched) public serials, freshest first. */
export async function fetchDiscover(query?: string): Promise<DiscoverSeries[]> {
  const q = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const res = await fetch(`${API_URL}/api/discover${q}`);
  if (!res.ok) throw new Error(`discover failed: ${res.status}`);
  const data = (await res.json()) as { series: DiscoverSeries[] };
  return data.series ?? [];
}

/** One public series with its chapter list and top-ranked discussion. */
export async function fetchSeries(bookId: string): Promise<SeriesDetail> {
  const res = await fetch(`${API_URL}/api/series/${bookId}`);
  if (!res.ok) throw new Error(`series failed: ${res.status}`);
  return (await res.json()) as SeriesDetail;
}

/** The web reader URL for a chapter — the mobile promo hands off to it. */
export function readerUrl(bookId: string, chapterIndex = 0): string {
  return `${API_URL}/series/${bookId}/read/${chapterIndex}`;
}
