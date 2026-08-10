import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

/**
 * POST /api/books/:bookId/unlock — spend coins to unlock content.
 *   { chapterIndex: n }  buys one chapter.
 *   {} (no chapterIndex)  buys every still-locked paid chapter of the book.
 * Returns the PurchaseResult { unlocked, coinsSpent, balance }. Sign-in required;
 * an empty wallet comes back 402 so the client can prompt a top-up.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const body = (await request.json().catch(() => ({}))) as { chapterIndex?: number };
    const repository = await getRepository();
    const result =
      typeof body.chapterIndex === 'number'
        ? await repository.unlockChapter(bookId, body.chapterIndex)
        : await repository.unlockBook(bookId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('insufficient coins')) {
      return NextResponse.json({ error: 'insufficient coins' }, { status: 402 });
    }
    return asResponse(error);
  }
}
