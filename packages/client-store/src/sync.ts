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

  async pull(): Promise<SyncResult> {
    const response = await this.fetcher('/api/books');
    if (!response.ok) throw new Error(`sync: /api/books ${response.status}`);
    const { books } = (await response.json()) as { books: ApiBook[] };

    const localBooks = new Map((await this.store.listBooks()).map((b) => [b.id, b]));
    await this.store.upsertBooks(books as CachedBook[]);
    await this.store.pruneBooksExcept(books.map((b) => b.id));

    let chaptersRefreshed = 0;
    for (const book of books) {
      const local = localBooks.get(book.id);
      const haveChapters = (await this.store.countChapters(book.id)) > 0;
      if (!local || local.updatedAt !== book.updatedAt || !haveChapters) {
        const contentResponse = await this.fetcher(`/api/books/${book.id}?include=content`);
        if (contentResponse.ok) {
          const { chapters } = (await contentResponse.json()) as { chapters: Chapter[] };
          await this.store.replaceChapters(book.id, chapters);
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
