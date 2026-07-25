import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

/** GET /api/books/:bookId/recordings — rendered multi-voice recordings. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    return NextResponse.json({ recordings: await repository.listChapterRecordings(bookId) });
  } catch (error) {
    return asResponse(error);
  }
}

/** POST /api/books/:bookId/recordings — register a rendered recording (owner only).
 *  Body: { chapterIndex, storagePath, durationSeconds? }. The audio bytes are
 *  uploaded to the recordings storage bucket separately; this records the pointer. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const body = (await request.json()) as {
      chapterIndex?: number;
      storagePath?: string;
      durationSeconds?: number;
    };
    if (typeof body.chapterIndex !== 'number' || body.chapterIndex < 0) {
      return NextResponse.json({ error: 'chapterIndex is required' }, { status: 400 });
    }
    if (!body.storagePath) {
      return NextResponse.json({ error: 'storagePath is required' }, { status: 400 });
    }
    const repository = await getRepository();
    const recording = await repository.saveChapterRecording({
      bookId,
      chapterIndex: body.chapterIndex,
      storagePath: body.storagePath,
      durationSeconds: typeof body.durationSeconds === 'number' ? body.durationSeconds : undefined,
    });
    return NextResponse.json({ recording }, { status: 201 });
  } catch (error) {
    return asResponse(error);
  }
}
