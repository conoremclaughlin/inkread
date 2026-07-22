import type { Annotation, Chapter, ReadingPosition } from '@inkread/core';
import type { CachedBook, ClientStore } from './store';

/**
 * Phase A sync: pull-only. Book and annotation lists are small and pulled
 * whole; chapter content is big and refetched only when a book's
 * updated_at changes (appends bump it server-side). Phase B adds the
 * outbox for offline writes.
 */

export type SyncFetch = (path: string) => Promise<Response>;

export interface SyncResult {
  books: number;
  chaptersRefreshed: number;
}

/** Non-2xx from the sync API — carries the status so callers can
 *  distinguish a dead session (401) from a server fault. */
export class SyncHttpError extends Error {
  constructor(
    path: string,
    readonly status: number,
  ) {
    super(`sync: ${path} ${status}`);
    this.name = 'SyncHttpError';
  }
}

interface ApiBook {
  id: string;
  title: string;
  author?: string;
  language: string;
  source: string;
  chapterCount: number;
  createdAt: string;
  updatedAt: string;
}

export class SyncEngine {
  constructor(
    private readonly store: ClientStore,
    private readonly fetcher: SyncFetch,
  ) {}

  /**
   * Fetch one book's chapter content into the cache. Returns the chapters,
   * or undefined when the fetch failed (offline / server error) — the cache
   * is left untouched in that case. Also used by readers as an on-demand
   * recovery path when a book's content is missing locally.
   */
  async pullBookContent(bookId: string): Promise<Chapter[] | undefined> {
    const response = await this.fetcher(`/api/books/${bookId}?include=content`);
    if (!response.ok) return undefined;
    const { chapters } = (await response.json()) as { chapters: Chapter[] };
    await this.store.replaceChapters(bookId, chapters);
    return chapters;
  }

  async pull(): Promise<SyncResult> {
    const response = await this.fetcher('/api/books');
    if (!response.ok) throw new SyncHttpError('/api/books', response.status);
    const { books } = (await response.json()) as { books: ApiBook[] };

    const localBooks = new Map((await this.store.listBooks()).map((b) => [b.id, b]));
    await this.store.upsertBooks(books as CachedBook[]);
    await this.store.pruneBooksExcept(books.map((b) => b.id));

    let chaptersRefreshed = 0;
    for (const book of books) {
      const local = localBooks.get(book.id);
      // Refetch when the content we hold isn't for the current version. Using
      // content_updated_at (not "any chapters exist") is what makes a failed
      // content fetch retry next pull instead of stale chapters passing as
      // current forever — upsertBooks above already advanced updated_at, so a
      // 503 here must not be mistaken for "downloaded".
      if (!local || local.contentUpdatedAt !== book.updatedAt) {
        if (await this.pullBookContent(book.id)) {
          chaptersRefreshed += 1;
        }
      }

      const annotationsResponse = await this.fetcher(`/api/books/${book.id}/annotations`);
      if (annotationsResponse.ok) {
        const { annotations } = (await annotationsResponse.json()) as {
          annotations: Annotation[];
        };
        await this.store.replaceAnnotations(book.id, annotations);
      }

      const positionResponse = await this.fetcher(`/api/books/${book.id}/position`);
      if (positionResponse.ok) {
        const { position } = (await positionResponse.json()) as {
          position: ReadingPosition | null;
        };
        if (position) await this.store.upsertPosition(position);
      }
    }

    await this.store.setMeta('last_sync_at', new Date().toISOString());
    return { books: books.length, chaptersRefreshed };
  }
}
