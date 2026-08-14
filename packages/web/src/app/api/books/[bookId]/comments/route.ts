import { NextResponse } from 'next/server';
import { asResponse, getRepository, UnauthorizedError } from '@/lib/data';
import { getPublicComments } from '@/lib/data/public';

type Params = { params: Promise<{ bookId: string }> };

/**
 * GET /api/books/:bookId/comments?chapter=N — reader comments on a chapter.
 * Anonymous visitors get the public discussion (public books only), so the
 * reader's comments drawer works for someone who hasn't signed in yet.
 */
export async function GET(request: Request, { params }: Params) {
  const { bookId } = await params;
  const chapter = Number(new URL(request.url).searchParams.get('chapter'));
  if (!Number.isInteger(chapter) || chapter < 0) {
    return NextResponse.json({ error: 'chapter query param is required' }, { status: 400 });
  }
  try {
    const repository = await getRepository();
    return NextResponse.json({ comments: await repository.listComments(bookId, chapter) });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ comments: await getPublicComments(bookId, chapter) });
    }
    return asResponse(error);
  }
}

/** POST /api/books/:bookId/comments — { chapterIndex, body }. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const body = (await request.json()) as { chapterIndex?: number; body?: string };
    if (typeof body.chapterIndex !== 'number' || body.chapterIndex < 0) {
      return NextResponse.json({ error: 'chapterIndex is required' }, { status: 400 });
    }
    const text = body.body?.trim();
    if (!text) {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }
    if (text.length > 4000) {
      return NextResponse.json({ error: 'comment is too long' }, { status: 400 });
    }
    const repository = await getRepository();
    const comment = await repository.createComment({
      bookId,
      chapterIndex: body.chapterIndex,
      body: text,
    });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return asResponse(error);
  }
}
