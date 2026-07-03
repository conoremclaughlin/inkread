import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    return NextResponse.json({ position: (await repository.getPosition(bookId)) ?? null });
  } catch (error) {
    return asResponse(error);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    const body = (await request.json()) as { chapterIndex?: number; offset?: number };
    await repository.savePosition({
      bookId,
      chapterIndex: body.chapterIndex ?? 0,
      offset: body.offset ?? 0,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return asResponse(error);
  }
}
