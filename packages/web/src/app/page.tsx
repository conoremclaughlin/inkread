import Link from 'next/link';
import { getRepository } from '@/lib/data';
import { signOut } from '@/lib/auth/actions';
import { ImportPdf } from '@/components/ImportPdf';
import { BookActions } from '@/components/BookActions';
import { LocalLibraryFallback } from '@/components/LocalFallback';

export default async function LibraryPage() {
  let books;
  let progress: Map<string, number>;
  try {
    const repository = await getRepository();
    books = await repository.listBooks();
    progress = new Map(
      await Promise.all(
        books.map(async (book): Promise<[string, number]> => {
          const position = await repository.getPosition(book.id);
          if (!position || book.chapterCount === 0) return [book.id, 0];
          return [book.id, Math.round(((position.chapterIndex + 1) / book.chapterCount) * 100)];
        }),
      ),
    );
  } catch {
    // Data layer unreachable — show the on-device library.
    return <LocalLibraryFallback />;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="font-serif text-3xl">inkread</h1>
        <div className="flex items-center gap-3">
          <ImportPdf />
          <form action={signOut}>
            <button className="rounded-full px-4 py-2.5 text-sm text-[#6b6459] transition hover:bg-[#f0e6da] hover:text-[#26221c]">
              Log out
            </button>
          </form>
        </div>
      </header>

      {books.length === 0 ? (
        <div className="mt-24 text-center">
          <h2 className="text-xl font-semibold">Your library is empty</h2>
          <p className="mx-auto mt-2 max-w-md text-[#6b6459]">
            Import a PDF and inkread will convert it into a clean, reflowable book you can read,
            listen to, and annotate — on your phone and right here.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {books.map((book) => (
            <li
              key={book.id}
              className="group flex rounded-xl border border-[#e6dfd4] bg-white"
            >
              <div className="w-1.5 shrink-0 rounded-l-xl bg-[#8b5e3c]" />
              <Link href={`/read/${book.id}`} className="flex-1 p-4 transition hover:bg-[#faf7f2]">
                <div className="font-semibold">{book.title}</div>
                {book.author ? <div className="text-sm text-[#6b6459]">{book.author}</div> : null}
                <div className="mt-1 text-xs text-[#6b6459]">
                  {book.chapterCount} chapters
                  {(progress.get(book.id) ?? 0) > 0 ? ` · ${progress.get(book.id)}% read` : ''}
                </div>
              </Link>
              <div className="flex items-center gap-1 px-3 text-sm">
                <Link
                  href={`/notes/${book.id}`}
                  className="rounded-lg px-3 py-2 font-medium text-[#8b5e3c] transition hover:bg-[#f0e6da]"
                >
                  Notes
                </Link>
                <BookActions bookId={book.id} title={book.title} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
