'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Annotation, Chapter, ReadingPosition } from '@inkread/core';
import type { CachedBook } from '@inkread/client-store';
import { getLocalStore } from '@/lib/localdb';
import { Reader } from '@/components/Reader';

/**
 * Offline fallbacks: when the server data layer is unreachable, the library
 * and reader render from the on-device SQLite cache instead.
 */

export function OfflineBadge() {
  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[#26221c]/85 px-4 py-1.5 text-xs font-medium text-[#faf7f2]">
      Offline — reading from this device
    </div>
  );
}

export function LocalLibraryFallback() {
  const [books, setBooks] = useState<CachedBook[]>();

  useEffect(() => {
    void getLocalStore()
      .then((store) => store.listBooks())
      .then(setBooks)
      .catch(() => setBooks([]));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-serif text-3xl">inkread</h1>
      {books === undefined ? (
        <p className="mt-10 text-[#6b6459]">Opening your device library…</p>
      ) : books.length === 0 ? (
        <p className="mt-10 text-[#6b6459]">
          Nothing cached on this device yet — connect once to sync your library.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {books.map((book) => (
            <li
              key={book.id}
              className="flex overflow-hidden rounded-xl border border-[#e6dfd4] bg-white"
            >
              <div className="w-1.5 shrink-0 bg-[#8b5e3c]" />
              <Link href={`/read/${book.id}`} className="flex-1 p-4 hover:bg-[#faf7f2]">
                <div className="font-semibold">{book.title}</div>
                {book.author ? <div className="text-sm text-[#6b6459]">{book.author}</div> : null}
                <div className="mt-1 text-xs text-[#6b6459]">{book.chapterCount} chapters</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <OfflineBadge />
    </main>
  );
}

interface LocalBookState {
  book: CachedBook;
  chapters: Chapter[];
  annotations: Annotation[];
  position: ReadingPosition | null;
}

export function LocalReadFallback({ bookId }: { bookId: string }) {
  const [state, setState] = useState<LocalBookState | 'loading' | 'missing'>('loading');

  useEffect(() => {
    void (async () => {
      try {
        const store = await getLocalStore();
        const book = await store.getBook(bookId);
        if (!book) {
          setState('missing');
          return;
        }
        const [chapters, annotations, position] = await Promise.all([
          store.getChapters(bookId),
          store.listAnnotations(bookId),
          store.getPosition(bookId),
        ]);
        if (chapters.length === 0) {
          setState('missing');
          return;
        }
        setState({ book, chapters, annotations, position: position ?? null });
      } catch {
        setState('missing');
      }
    })();
  }, [bookId]);

  if (state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center text-[#6b6459]">
        Opening from this device…
      </main>
    );
  }
  if (state === 'missing') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-serif text-xl">This book isn’t cached on this device</p>
        <p className="max-w-md text-sm text-[#6b6459]">
          Connect once while logged in and it will sync automatically for offline reading.
        </p>
        <Link href="/" className="mt-2 text-sm font-semibold text-[#8b5e3c]">
          ← Library
        </Link>
        <OfflineBadge />
      </main>
    );
  }

  return (
    <>
      <Reader
        book={{
          ...state.book,
          source: state.book.source as 'pdf' | 'epub' | 'text',
        }}
        chapters={state.chapters}
        initialAnnotations={state.annotations}
        initialPosition={state.position}
        offline
      />
      <OfflineBadge />
    </>
  );
}
