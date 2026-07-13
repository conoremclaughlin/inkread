import { notFound } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { Reader } from '@/components/Reader';
import { LocalReadFallback } from '@/components/LocalFallback';

export default async function ReadPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;

  try {
    const repository = await getRepository();
    const book = await repository.getBook(bookId);
    if (!book) notFound();

    const [chapters, annotations, position, preferences] = await Promise.all([
      repository.getChapters(bookId),
      repository.listAnnotations(bookId),
      repository.getPosition(bookId),
      repository.getPreferences(),
    ]);
    if (!chapters || chapters.length === 0) notFound();

    return (
      <Reader
        book={book}
        chapters={chapters}
        initialAnnotations={annotations}
        initialPosition={position ?? null}
        initialPreferences={preferences}
      />
    );
  } catch (error) {
    // notFound() must propagate. Everything else — including the null-user
    // result auth returns when its backend is unreachable — falls back to
    // the on-device cache. (Genuinely logged-out visitors never reach this
    // page: middleware redirects them while the server is reachable.)
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return <LocalReadFallback bookId={bookId} />;
  }
}
