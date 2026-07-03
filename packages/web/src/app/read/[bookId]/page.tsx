import { notFound } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { Reader } from '@/components/Reader';

export default async function ReadPage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const repository = await getRepository();
  const book = await repository.getBook(bookId);
  if (!book) notFound();

  const [chapters, annotations, position] = await Promise.all([
    repository.getChapters(bookId),
    repository.listAnnotations(bookId),
    repository.getPosition(bookId),
  ]);
  if (!chapters || chapters.length === 0) notFound();

  return (
    <Reader
      book={book}
      chapters={chapters}
      initialAnnotations={annotations}
      initialPosition={position ?? null}
    />
  );
}
