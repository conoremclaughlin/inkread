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
