import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Annotation } from '@inkread/core';
import { HIGHLIGHT_COLORS } from '@inkread/core';
import { getRepository } from '@/lib/data';

export default async function NotesPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const repository = await getRepository();
  const book = await repository.getBook(bookId);
  if (!book) notFound();
  const annotations = await repository.listAnnotations(bookId);

  const byChapter = new Map<number, { title: string; items: Annotation[] }>();
  for (const annotation of annotations) {
    const index = annotation.locator.chapterIndex;
    if (!byChapter.has(index)) {
      byChapter.set(index, {
        title: annotation.chapterTitle ?? `Chapter ${index + 1}`,
        items: [],
      });
    }
    byChapter.get(index)!.items.push(annotation);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/read/${bookId}`} className="text-sm font-medium text-[#8b5e3c]">
            ← Back to book
          </Link>
          <h1 className="mt-1 truncate font-serif text-2xl" title={book.title}>
            Notes · {book.title}
          </h1>
        </div>
        <div className="flex shrink-0 gap-3 text-sm">
          <a
            href={`/api/books/${bookId}/export?format=markdown`}
            className="whitespace-nowrap rounded-full bg-[#8b5e3c] px-4 py-2 font-semibold text-white transition hover:bg-[#75492c]"
          >
            Export Markdown
          </a>
          <a
            href={`/api/books/${bookId}/export?format=epub`}
            className="whitespace-nowrap rounded-full border border-[#8b5e3c] px-4 py-2 font-semibold text-[#8b5e3c] transition hover:bg-[#f0e6da]"
          >
            Download EPUB
          </a>
        </div>
      </header>

      {annotations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-24 text-center">
          <p className="font-serif text-xl text-[#26221c]">No notes yet</p>
          <p className="mx-auto mt-2 max-w-md text-[#6b6459]">
            Select any passage while reading to highlight it or attach a note — everything you
            save collects here, ready to export.
          </p>
          <Link
            href={`/read/${bookId}`}
            className="mt-6 rounded-full border border-[#8b5e3c] px-5 py-2 text-sm font-semibold text-[#8b5e3c] transition hover:bg-[#f0e6da]"
          >
            Open the book →
          </Link>
        </div>
      ) : (
        [...byChapter.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([index, section]) => (
            <section key={index} className="mt-8">
              <h2 className="text-xs font-bold uppercase tracking-wide text-[#6b6459]">
                {section.title}
              </h2>
              <ul className="mt-3 space-y-3">
                {section.items.map((annotation) => (
                  <li
                    key={annotation.id}
                    className="flex overflow-hidden rounded-xl border border-[#e6dfd4] bg-white"
                  >
                    <div
                      className="w-1.5 shrink-0"
                      style={{
                        background: `rgb(${HIGHLIGHT_COLORS[annotation.color] ?? HIGHLIGHT_COLORS['yellow']})`,
                      }}
                    />
                    <div className="p-4">
                      <p className="italic">“{annotation.passage}”</p>
                      {annotation.note ? (
                        <p className="mt-2 text-sm text-[#6b6459]">{annotation.note}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
    </main>
  );
}
