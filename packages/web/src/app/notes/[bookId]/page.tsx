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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <Link href={`/read/${bookId}`} className="text-sm font-medium text-[#8b5e3c]">
            ← Back to book
          </Link>
          <h1 className="mt-1 font-serif text-2xl">Notes · {book.title}</h1>
        </div>
        <div className="flex gap-3 text-sm">
          <a
            href={`/api/books/${bookId}/export?format=markdown`}
            className="rounded-full bg-[#8b5e3c] px-4 py-2 font-semibold text-white"
          >
            Export Markdown
          </a>
          <a
            href={`/api/books/${bookId}/export?format=epub`}
            className="rounded-full border border-[#8b5e3c] px-4 py-2 font-semibold text-[#8b5e3c]"
          >
            Download EPUB
          </a>
        </div>
      </header>

      {annotations.length === 0 ? (
        <p className="mt-16 text-center text-[#6b6459]">
          No notes yet — select any passage while reading to highlight it or attach a note.
        </p>
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
