import { notFound } from 'next/navigation';
import type { Annotation, ReadChapter } from '@inkread/core';
import { createClient } from '@/lib/supabase/server';
import { getRepository } from '@/lib/data';
import { getPublicChapter, getPublicSeries } from '@/lib/data/public';
import { Reader } from '@/components/Reader';

type Params = { params: Promise<{ bookId: string; chapter: string }> };

/**
 * Reading a published series — the same reader the owner uses, pointed at a
 * public `ChapterSource` instead of an in-memory book.
 *
 * The page's job is only to resolve *who is asking* and hand the reader its
 * first chapter: bodies come through the entitlement gate (anonymous visitors
 * get the free head; a signed-in reader gets their unlocks honoured), and a
 * locked chapter arrives without text so the reader draws a paywall. Everything
 * after the first paint — turning chapters, unlocking, highlighting, listening
 * — happens client-side through the source.
 */
export default async function SeriesReadPage({ params }: Params) {
  const { bookId, chapter } = await params;
  const index = Number.parseInt(chapter, 10);
  if (!Number.isInteger(index) || index < 0) notFound();

  const detail = await getPublicSeries(bookId);
  if (!detail) notFound();
  const { series } = detail;
  if (index >= series.chapterCount) notFound();

  const supabase = await createClient();
  let userId: string | undefined;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id;
  } catch {
    userId = undefined;
  }
  const signedIn = Boolean(userId);

  let read: ReadChapter | undefined;
  let balance = 0;
  let unlocked: number[] = [];
  let annotations: Annotation[] = [];
  if (signedIn) {
    const repository = await getRepository();
    const [chap, wallet, owned, notes] = await Promise.all([
      repository.readChapter(bookId, index),
      repository.getWallet(),
      repository.listMyUnlocks(bookId),
      // A reader's highlights on someone else's book are still theirs.
      repository.listAnnotations(bookId).catch(() => []),
    ]);
    read = chap;
    balance = wallet.balance;
    unlocked = owned;
    annotations = notes;
  } else {
    read = await getPublicChapter(bookId, index);
  }
  if (!read) notFound();

  // The TOC is public even where the bodies aren't, so chapter navigation and
  // the "N / M" footer work from the first paint.
  const titles = Array.from(
    { length: series.chapterCount },
    (_, i) => detail.chapters.find((c) => c.index === i)?.title ?? `Chapter ${i + 1}`,
  );

  return (
    <Reader
      book={{
        id: bookId,
        title: series.title,
        author: series.author,
        source: 'text',
        chapterCount: series.chapterCount,
        createdAt: series.updatedAt,
        updatedAt: series.updatedAt,
      }}
      publicSeries={{
        bookId,
        titles,
        signedIn,
        balance,
        unlocked,
        pricing: {
          freeChapterCount: series.freeChapterCount,
          coinsPerChapter: series.coinsPerChapter,
        },
        initial: {
          index,
          title: read.title,
          paragraphs: read.paragraphs,
          locked: read.locked,
          coinCost: read.coinCost,
        },
      }}
      initialAnnotations={annotations}
      // The URL is the position here: /read/3 opens chapter three.
      initialPosition={{ bookId, chapterIndex: index, offset: 0, updatedAt: series.updatedAt }}
      currentUserId={userId}
      backHref={`/series/${bookId}`}
      backLabel={series.title}
    />
  );
}
