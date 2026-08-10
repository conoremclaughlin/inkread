import Link from 'next/link';
import { notFound } from 'next/navigation';
import { chapterCoinCost } from '@inkread/core';
import { createClient } from '@/lib/supabase/server';
import { getPublicSeries } from '@/lib/data/public';
import { CommentsBoard } from '@/components/CommentsBoard';
import { coverInitials, coverPalette } from '@/lib/cover';
import { relativeTime } from '@/lib/relativeTime';

type Params = { params: Promise<{ bookId: string }> };

/** Public series page: the work, its chapters, and its vote-ranked discussion. */
export default async function SeriesPage({ params }: Params) {
  const { bookId } = await params;
  const detail = await getPublicSeries(bookId);
  if (!detail) notFound();
  const { series, chapters, comments } = detail;
  const pricing = {
    freeChapterCount: series.freeChapterCount,
    coinsPerChapter: series.coinsPerChapter,
  };
  const isPaid = series.coinsPerChapter > 0;

  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }

  const palette = coverPalette(series.title);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-sm text-[#6b6459] transition hover:text-[#26221c]">
          ← Discover
        </Link>
        <Link href="/" className="font-serif text-xl text-[#26221c]">
          inkread
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-16">
        {/* Work header */}
        <section className="flex gap-6 border-b border-[#ece4d7] pb-10 pt-4">
          <div
            className="flex h-40 w-28 shrink-0 items-center justify-center rounded-lg font-serif text-3xl shadow-md"
            style={{ backgroundColor: palette.bg, color: palette.fg }}
            aria-hidden
          >
            {coverInitials(series.title)}
          </div>
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef4ee] px-2.5 py-1 text-xs font-medium text-[#4a5d4e]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4a5d4e]" />
              {series.status === 'completed' ? 'Completed' : 'Ongoing'}
            </span>
            <h1 className="mt-3 font-serif text-3xl leading-tight text-[#26221c]">
              {series.title}
            </h1>
            {series.author ? (
              <p className="mt-1 text-[#6b6459]">{series.author}</p>
            ) : null}
            <p className="mt-3 text-sm text-[#8a8175]">
              {series.chapterCount} chapter{series.chapterCount === 1 ? '' : 's'} · updated{' '}
              {relativeTime(series.updatedAt)} · {series.commentCount} comment
              {series.commentCount === 1 ? '' : 's'}
            </p>
            {isPaid ? (
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[#8b5e3c]">
                <CoinGlyph />
                {series.freeChapterCount > 0
                  ? `First ${series.freeChapterCount} chapter${series.freeChapterCount === 1 ? '' : 's'} free · then ${series.coinsPerChapter} coins each`
                  : `${series.coinsPerChapter} coins per chapter`}
              </p>
            ) : null}
            <Link
              href={`/series/${series.id}/read/0`}
              className="mt-5 inline-block rounded-full bg-[#8b5e3c] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#7a5133]"
            >
              Start reading
            </Link>
          </div>
        </section>

        {/* Chapters — capped in a scroll box so a long serial never buries the
            discussion below it. */}
        <section className="border-b border-[#ece4d7] py-8">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-serif text-xl text-[#26221c]">Chapters</h2>
            <span className="text-sm text-[#8a8175]">{chapters.length}</span>
          </div>
          {chapters.length === 0 ? (
            <p className="text-[#8a8175]">No chapters published yet.</p>
          ) : (
            <ol
              className={
                chapters.length > 12
                  ? 'max-h-[26rem] space-y-1 overflow-y-auto rounded-xl border border-[#ece4d7] bg-white/40 p-2'
                  : 'space-y-1'
              }
            >
              {chapters.map((chapter) => {
                const cost = chapterCoinCost(pricing, chapter.index);
                return (
                  <li key={chapter.index}>
                    <Link
                      href={`/series/${series.id}/read/${chapter.index}`}
                      className="flex items-baseline gap-3 rounded-lg px-3 py-2 transition hover:bg-white"
                    >
                      <span className="w-8 shrink-0 text-right text-sm tabular-nums text-[#a49a8b]">
                        {chapter.index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[#332e26]">{chapter.title}</span>
                      {cost > 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#b08a5e]">
                          <CoinGlyph />
                          {cost}
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-[#b8ae9e]">Free</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Discussion — prominent, vote-ranked */}
        <section className="py-8">
          <h2 className="mb-1 font-serif text-2xl text-[#26221c]">Discussion</h2>
          <p className="mb-6 text-[#6b6459]">
            Reader comments, most-upvoted first.{' '}
            {signedIn ? '' : 'Sign in to add yours and vote.'}
          </p>
          <CommentsBoard comments={comments} signedIn={signedIn} />
        </section>
      </main>
    </div>
  );
}

/** A small coin mark for prices and lock badges. */
function CoinGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="inline-block">
      <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6" cy="6" r="2" fill="currentColor" />
    </svg>
  );
}
