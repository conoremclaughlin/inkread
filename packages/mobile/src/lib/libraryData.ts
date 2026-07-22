import type { Annotation, Chapter, ReadingPosition } from '@inkread/core';
import { SyncEngine, type CachedBook } from '@inkread/client-store';
import { getClientStore } from '../store/clientStore';
import { apiFetch } from './api';

/**
 * Write-through data helpers: reads come from the on-device cache, writes
 * go to the API and refresh the cache. (Offline writes queue in Phase B.)
 */

export interface LoadedBook {
  book: CachedBook;
  chapters: Chapter[];
  annotations: Annotation[];
  position: ReadingPosition | null;
}

export async function loadBook(bookId: string): Promise<LoadedBook | null> {
  const store = await getClientStore();
  const book = await store.getBook(bookId);
  if (!book) return null;
  let [chapters, annotations, position] = await Promise.all([
    store.getChapters(bookId),
    store.listAnnotations(bookId),
    store.getPosition(bookId),
  ]);
  if (chapters.length === 0) {
    // The cache has the book row but no content (interrupted first sync,
    // crash mid-refresh). Recover on demand from the API rather than
    // dead-ending the reader; offline, this stays null and the screen
    // offers a retry.
    try {
      chapters =
        (await new SyncEngine(store, (path) => apiFetch(path)).pullBookContent(bookId)) ?? [];
    } catch {
      chapters = [];
    }
  }
  if (chapters.length === 0) return null;
  return { book, chapters, annotations, position: position ?? null };
}

export async function refreshAnnotations(bookId: string): Promise<Annotation[]> {
  const store = await getClientStore();
  try {
    const response = await apiFetch(`/api/books/${bookId}/annotations`);
    if (response.ok) {
      const { annotations } = (await response.json()) as { annotations: Annotation[] };
      await store.replaceAnnotations(bookId, annotations);
      return annotations;
    }
  } catch {
    // Offline — serve what the cache has.
  }
  return store.listAnnotations(bookId);
}

export async function createAnnotation(
  bookId: string,
  input: {
    chapterIndex: number;
    start: number;
    end: number;
    passage: string;
    note?: string;
    color: string;
    chapterTitle?: string;
  },
): Promise<void> {
  const response = await apiFetch(`/api/books/${bookId}/annotations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Saving requires a connection right now.');
}

export async function updateAnnotationNote(id: string, note: string | undefined): Promise<void> {
  const response = await apiFetch(`/api/annotations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note ?? null }),
  });
  if (!response.ok) throw new Error('Saving requires a connection right now.');
}

export async function updateAnnotationColor(id: string, color: string): Promise<void> {
  const response = await apiFetch(`/api/annotations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ color }),
  });
  if (!response.ok) throw new Error('Saving requires a connection right now.');
}

export async function deleteAnnotation(id: string): Promise<void> {
  const response = await apiFetch(`/api/annotations/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Deleting requires a connection right now.');
}

/** Local-first position save: cache immediately, server best-effort. */
export async function persistPosition(
  position: Omit<ReadingPosition, 'updatedAt'>,
): Promise<void> {
  const store = await getClientStore();
  await store.upsertPosition({ ...position, updatedAt: new Date().toISOString() });
  void apiFetch(`/api/books/${position.bookId}/position`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapterIndex: position.chapterIndex, offset: position.offset }),
  }).catch(() => undefined);
}
