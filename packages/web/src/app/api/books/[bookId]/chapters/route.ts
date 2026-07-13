import { NextResponse } from 'next/server';
import type { Chapter } from '@inkread/core';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

/** POST: append chapters to an existing book (serialized works). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    const body = (await request.json()) as { chapters?: Chapter[] };
    if (!Array.isArray(body.chapters) || body.chapters.length === 0) {
      return NextResponse.json({ error: 'non-empty chapters array required' }, { status: 400 });
    }
    const book = await repository.appendChapters(bookId, body.chapters);
    return NextResponse.json({ book }, { status: 201 });
  } catch (error) {
    return asResponse(error);
  }
}
