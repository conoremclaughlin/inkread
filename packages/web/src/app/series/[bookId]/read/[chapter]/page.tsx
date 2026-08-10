import Link from 'next/link';
import { notFound } from 'next/navigation';
import { remainingUnlockCost, type ReadChapter } from '@inkread/core';
import { createClient } from '@/lib/supabase/server';
import { getRepository } from '@/lib/data';
import { getPublicChapter, getPublicSeries } from '@/lib/data/public';
import { ReaderPaywall } from '@/components/ReaderPaywall';

type Params = { params: Promise<{ bookId: string; chapter: string }> };

/**
 * Public chapter reader for a published series — works for anonymous visitors
 * (free head only) and signed-in readers (their unlocks honored). Bodies come
 * through the entitlement gate; a locked chapter renders the paywall instead.
 * Kept separate from the owner's rich library reader so the paywall path stays
 * simple and the owner experience is untouched.
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
  let signedIn = false;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }

  let read: ReadChapter | undefined;
  let balance = 0;
  let unlocked: number[] = [];
  if (signedIn) {
    const repository = await getRepository();
    const [chap, wallet, owned] = await Promise.all([
      repository.readChapter(bookId, index),
      repository.getWallet(),
      repository.listMyUnlocks(bookId),
    ]);
    read = chap;
    balance = wallet.balance;
    unlocked = owned;
  } else {
    read = await getPublicChapter(bookId, index);
  }
  if (!read) notFound();

  const pricing = {
    freeChapterCount: series.freeChapterCount,
    coinsPerChapter: series.coinsPerChapter,
  };
  const ownedSet = new Set(unlocked);
  const remainingBookCost = remainingUnlockCost(pricing, series.chapterCount, ownedSet);
  let remainingCount = 0;
  if (series.coinsPerChapter > 0) {
    for (let i = series.freeChapterCount; i < series.chapterCount; i += 1) {
      if (!ownedSet.has(i)) remainingCount += 1;
    }
  }

  const prev = index > 0 ? index - 1 : null;
  const next = index < series.chapterCount - 1 ? index + 1 : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[#ece4d7] bg-[#faf7f2]/85 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-6 py-3.5">
          <Link
            href={`/series/${bookId}`}
            className="min-w-0 truncate text-sm text-[#6b6459] transition hover:text-[#26221c]"
          >
            ← {series.title}
          </Link>
          {signedIn ? (
            <span className="shrink-0 rounded-full bg-[#f3ead9] px-3 py-1 text-xs font-semibold text-[#8b5e3c]">
              {balance} coins
            </span>
          ) : (
            <Link
              href="/login"
              className="shrink-0 text-sm font-medium text-[#8b5e3c] transition hover:text-[#7a5133]"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-20 pt-8">
        <p className="text-sm font-medium uppercase tracking-wide text-[#a49a8b]">
          Chapter {index + 1}
        </p>
        <h1 className="mt-1 font-serif text-3xl leading-tight text-[#26221c]">{read.title}</h1>

        {read.locked ? (
          <ReaderPaywall
            bookId={bookId}
            chapterIndex={index}
            coinCost={read.coinCost}
            signedIn={signedIn}
            balance={balance}
            remainingCount={remainingCount}
            remainingBookCost={remainingBookCost}
          />
        ) : (
          <article className="mt-8 space-y-5 font-serif text-[1.075rem] leading-[1.8] text-[#2c2820]">
            {(read.paragraphs ?? []).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </article>
        )}

        <nav className="mt-12 flex items-center justify-between border-t border-[#ece4d7] pt-6 text-sm">
          {prev !== null ? (
            <Link
              href={`/series/${bookId}/read/${prev}`}
              className="rounded-full border border-[#e0d8ca] px-4 py-2 text-[#6b6459] transition hover:border-[#8b5e3c] hover:text-[#26221c]"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {next !== null ? (
            <Link
              href={`/series/${bookId}/read/${next}`}
              className="rounded-full border border-[#e0d8ca] px-4 py-2 text-[#6b6459] transition hover:border-[#8b5e3c] hover:text-[#26221c]"
            >
              Next →
            </Link>
          ) : (
            <span className="text-[#a49a8b]">The End · more to come</span>
          )}
        </nav>
      </main>
    </div>
  );
}
