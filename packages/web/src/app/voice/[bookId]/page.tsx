import { notFound } from 'next/navigation';
import { getRepository } from '@/lib/data';
import { VoiceEditor } from '@/components/VoiceEditor';

// Web-only multi-voice cast editor (there's no mobile route for it).
export default async function VoicePage({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const repository = await getRepository();
  const book = await repository.getBook(bookId);
  if (!book) notFound();

  const [chapters, cast] = await Promise.all([
    repository.getChapters(bookId),
    repository.getVoiceCast(bookId),
  ]);
  if (!chapters || chapters.length === 0) notFound();

  return <VoiceEditor book={book} chapters={chapters} initialCast={cast ?? null} />;
}
