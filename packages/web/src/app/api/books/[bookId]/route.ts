import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    const book = await repository.getBook(bookId);
    if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    if (searchParams.get('include') === 'content') {
      const chapters = await repository.getChapters(bookId);
      return NextResponse.json({ book, chapters: chapters ?? [] });
    }
    return NextResponse.json({ book });
  } catch (error) {
    return asResponse(error);
  }
}

/** PATCH /api/books/:bookId — owner publishes/unpublishes and sets status. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const body = (await request.json()) as {
      visibility?: 'private' | 'public';
      status?: 'ongoing' | 'completed';
    };
    if (body.visibility && !['private', 'public'].includes(body.visibility)) {
      return NextResponse.json({ error: 'invalid visibility' }, { status: 400 });
    }
    if (body.status && !['ongoing', 'completed'].includes(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    if (!body.visibility && !body.status) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }
    const repository = await getRepository();
    const book = await repository.setBookPublication(bookId, body);
    return NextResponse.json({ book });
  } catch (error) {
    return asResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    await repository.deleteBook(bookId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return asResponse(error);
  }
}
