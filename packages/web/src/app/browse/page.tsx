import Link from 'next/link';
import { listPublicSeries, type PublicSeries } from '@/lib/data/public';
import { SeriesCard } from '@/components/SeriesCard';

/**
 * Discovery hub — search public serials by title/author, or browse them split
 * into Ongoing and Completed. Open to everyone (no session). A plain GET form
 * keeps search working without client JS.
 */
export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = ((await searchParams).q ?? '').trim();

  let results: PublicSeries[] | null = null;
  let ongoing: PublicSeries[] = [];
  let completed: PublicSeries[] = [];
  if (query) {
    results = await listPublicSeries({ query });
  } else {
    [ongoing, completed] = await Promise.all([
      listPublicSeries({ status: 'ongoing' }),
      listPublicSeries({ status: 'completed' }),
    ]);
  }

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="font-serif text-2xl tracking-tight text-[#26221c]">
          inkread
        </Link>
        <Link href="/" className="text-sm text-[#6b6459] transition hover:text-[#26221c]">
          ← Home
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-16">
        <h1 className="mt-4 font-serif text-3xl text-[#26221c]">Browse serials</h1>

        <form action="/browse" method="get" className="mt-5 flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by title or author…"
            className="min-w-0 flex-1 rounded-full border border-[#e6dfd4] bg-white px-5 py-2.5 text-[15px] text-[#332e26] outline-none transition focus:border-[#8b5e3c]"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-[#8b5e3c] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#7a5133]"
          >
            Search
          </button>
        </form>

        {results ? (
          <Section
            title={`Results for “${query}”`}
            series={results}
            empty="No serials match that search."
          />
        ) : (
          <>
            <Section title="Ongoing" series={ongoing} empty="No ongoing serials yet." />
            <Section title="Completed" series={completed} empty="No completed serials yet." />
          </>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  series,
  empty,
}: {
  title: string;
  series: PublicSeries[];
  empty: string;
}) {
  return (
    <section className="py-8">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="font-serif text-2xl text-[#26221c]">{title}</h2>
        <span className="text-sm text-[#8a8175]">{series.length}</span>
      </div>
      {series.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#e0d8ca] bg-[#fbf8f2] px-6 py-10 text-center text-[#8a8175]">
          {empty}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {series.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      )}
    </section>
  );
}
