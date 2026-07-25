import type { Annotation, Chapter, ReadingPosition } from '@inkread/core';
import { SyncEngine, type CachedBook, type OutboxEntry } from '@inkread/client-store';
import { getClientStore } from '../store/clientStore';
import { apiFetch } from './api';

/**
 * Local-first data helpers. Reads come from the on-device cache; writes land in
 * the cache immediately and queue in the outbox, which drains to the server
 * whenever a connection is available. Nothing here throws when offline — a
 * highlight made on a plane must appear at once and sync later.
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
  // Push local edits first so the fetch below returns them as canonical rather
  // than a stale set that would look like they were dropped.
  await flushOutbox();
  try {
    const response = await apiFetch(`/api/books/${bookId}/annotations`);
    if (response.ok) {
      const { annotations } = (await response.json()) as { annotations: Annotation[] };
      // replaceAnnotations preserves any still-pending local writes, so an
      // in-flight create/edit/delete survives this overwrite.
      await store.replaceAnnotations(bookId, annotations);
    }
  } catch {
    // Offline — serve what the cache has.
  }
  return store.listAnnotations(bookId);
}

/**
 * RFC-4122 v4 id, generated on-device so a new annotation has a stable id from
 * birth — an offline create needs one before any server round-trip, and it
 * stays the same id once it reaches the server. Not a security boundary, so
 * Math.random (rather than a crypto source RN lacks by default) is fine.
 */
function newId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
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
): Promise<Annotation> {
  const store = await getClientStore();
  const annotation: Annotation = {
    id: newId(),
    bookId,
    kind: input.note ? 'note' : 'highlight',
    locator: { chapterIndex: input.chapterIndex, start: input.start, end: input.end },
    passage: input.passage,
    note: input.note,
    color: input.color as Annotation['color'],
    chapterTitle: input.chapterTitle,
    createdAt: new Date().toISOString(),
  };
  await store.insertAnnotation(annotation);
  await store.enqueueOutbox({
    op: 'create',
    annotationId: annotation.id,
    bookId,
    payload: {
      id: annotation.id,
      chapterIndex: input.chapterIndex,
      start: input.start,
      end: input.end,
      passage: input.passage,
      note: input.note,
      color: input.color,
      chapterTitle: input.chapterTitle,
    },
    createdAt: annotation.createdAt,
  });
  void flushOutbox();
  return annotation;
}

export async function updateAnnotationNote(id: string, note: string | undefined): Promise<void> {
  const store = await getClientStore();
  const trimmed = note?.trim() ? note.trim() : undefined;
  // Mirror the server: a note makes it a 'note', clearing it a plain highlight.
  await store.updateAnnotation(id, { note: trimmed ?? null, kind: trimmed ? 'note' : 'highlight' });
  await store.enqueueOutbox({
    op: 'update',
    annotationId: id,
    payload: { note: trimmed ?? null },
    createdAt: new Date().toISOString(),
  });
  void flushOutbox();
}

export async function updateAnnotationColor(id: string, color: string): Promise<void> {
  const store = await getClientStore();
  await store.updateAnnotation(id, { color });
  await store.enqueueOutbox({
    op: 'update',
    annotationId: id,
    payload: { color },
    createdAt: new Date().toISOString(),
  });
  void flushOutbox();
}

export async function deleteAnnotation(id: string): Promise<void> {
  const store = await getClientStore();
  await store.deleteAnnotationById(id);
  // If this annotation was created offline and never reached the server, drop
  // its queued ops instead of pushing a phantom create-then-delete that another
  // device would briefly see appear and vanish.
  const queued = (await store.listOutbox()).filter((entry) => entry.annotationId === id);
  const neverReachedServer = queued.some((entry) => entry.op === 'create');
  for (const entry of queued) await store.deleteOutboxEntry(entry.seq);
  if (!neverReachedServer) {
    await store.enqueueOutbox({
      op: 'delete',
      annotationId: id,
      createdAt: new Date().toISOString(),
    });
  }
  void flushOutbox();
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

// --- outbox delivery -------------------------------------------------------

let flushInFlight: Promise<void> | null = null;

/**
 * Drain queued annotation writes to the server, oldest first. Concurrent calls
 * share one in-flight run (so `await flushOutbox()` reliably waits for a drain
 * rather than racing a fire-and-forget one). Stops at the first entry that
 * needs a retry to preserve order — a create must land before the update or
 * delete that follow it.
 */
export function flushOutbox(): Promise<void> {
  if (!flushInFlight) {
    flushInFlight = drainOutbox().finally(() => {
      flushInFlight = null;
    });
  }
  return flushInFlight;
}

async function drainOutbox(): Promise<void> {
  const store = await getClientStore();
  for (const entry of await store.listOutbox()) {
    const result = await deliver(entry);
    if (result === 'retry') break;
    await store.deleteOutboxEntry(entry.seq);
  }
}

type DeliverResult = 'done' | 'retry' | 'drop';

async function deliver(entry: OutboxEntry): Promise<DeliverResult> {
  let response: Response;
  try {
    if (entry.op === 'create') {
      response = await apiFetch(`/api/books/${entry.bookId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload ?? {}),
      });
    } else if (entry.op === 'update') {
      response = await apiFetch(`/api/annotations/${entry.annotationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload ?? {}),
      });
    } else {
      response = await apiFetch(`/api/annotations/${entry.annotationId}`, { method: 'DELETE' });
    }
  } catch {
    return 'retry'; // offline / network error — try again next flush
  }
  if (response.ok) return 'done';
  // A delete of something already gone server-side is, for our purpose, done.
  if (entry.op === 'delete' && response.status === 404) return 'done';
  // 5xx / 429: a transient server fault — keep the entry and retry later.
  if (response.status >= 500 || response.status === 429) return 'retry';
  // 4xx: the server rejected the payload; retrying won't help. Drop it rather
  // than wedge everything queued behind it, but say so — it's silent data loss.
  console.warn(`[outbox] dropping ${entry.op} ${entry.annotationId}: server ${response.status}`);
  return 'drop';
}
