import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listActiveSeries, listTopPublicComments } from '@/lib/data/public';
import { SeriesCard } from '@/components/SeriesCard';
import { CommentsBoard } from '@/components/CommentsBoard';

/**
 * Public home / discovery page — open to everyone, no session required. Browse
 * the serials being actively published, then read the liveliest reader
 * comments (vote-ranked) across all of them at the bottom.
 */
export default async function HomePage() {
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

  const [series, topComments] = await Promise.all([
    listActiveSeries(),
    listTopPublicComments(8),
  ]);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="font-serif text-2xl tracking-tight text-[#26221c]">
          inkread
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          {signedIn ? (
            <Link
              href="/library"
              className="rounded-full bg-[#8b5e3c] px-4 py-2 font-medium text-white transition hover:bg-[#7a5133]"
            >
              Your library
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-4 py-2 text-[#6b6459] transition hover:bg-[#f0e6da] hover:text-[#26221c]"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-[#8b5e3c] px-4 py-2 font-medium text-white transition hover:bg-[#7a5133]"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        {/* Hero */}
        <section className="border-b border-[#ece4d7] py-14 text-center sm:py-20">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#a9772f]">
            Serialized reading
          </p>
          <h1 className="mx-auto mt-4 max-w-2xl font-serif text-4xl leading-tight text-[#26221c] sm:text-5xl">
            Follow the stories being written right now.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-[#6b6459]">
            Browse serials as their chapters arrive, listen with natural voices, and read along with
            a community in the margins.
          </p>
          <form
            action="/browse"
            method="get"
            className="mx-auto mt-7 flex max-w-md gap-2"
          >
            <input
              type="search"
              name="q"
              placeholder="Search serials by title or author…"
              className="min-w-0 flex-1 rounded-full border border-[#e6dfd4] bg-white px-5 py-2.5 text-[15px] text-[#332e26] outline-none transition focus:border-[#8b5e3c]"
            />
            <button
              type="submit"
              className="shrink-0 rounded-full bg-[#8b5e3c] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#7a5133]"
            >
              Search
            </button>
          </form>
        </section>

        {/* Actively publishing */}
        <section className="py-12">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="font-serif text-2xl text-[#26221c]">Actively publishing</h2>
            <Link href="/browse" className="text-sm font-medium text-[#8b5e3c] transition hover:text-[#7a5133]">
              Browse all →
            </Link>
          </div>
          {series.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#e0d8ca] bg-[#fbf8f2] px-6 py-16 text-center">
              <p className="font-serif text-lg text-[#26221c]">No public series yet</p>
              <p className="mx-auto mt-2 max-w-md text-[#6b6459]">
                {signedIn
                  ? 'Publish a book from your library and it will appear here for everyone to follow.'
                  : 'Sign in and publish a work to start a serial the whole community can follow.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {series.map((s) => (
                <SeriesCard key={s.id} series={s} />
              ))}
            </div>
          )}
        </section>

        {/* Community discussion — prominent at the bottom, ranked by votes */}
        <section className="border-t border-[#ece4d7] py-12">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="font-serif text-2xl text-[#26221c]">What readers are saying</h2>
          </div>
          <p className="mb-6 max-w-xl text-[#6b6459]">
            The most-upvoted comments across every series. {signedIn ? '' : 'Sign in to join in and vote.'}
          </p>
          <CommentsBoard comments={topComments} signedIn={signedIn} showSeries />
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-6 py-10 text-sm text-[#a49a8b]">
        inkread — read, listen, annotate.
      </footer>
    </div>
  );
}
