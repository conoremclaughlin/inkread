import { NextResponse } from 'next/server';
import { asResponse, getRepository, type CreateAnnotationInput } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    return NextResponse.json({ annotations: await repository.listAnnotations(bookId) });
  } catch (error) {
    return asResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    const body = (await request.json()) as Omit<CreateAnnotationInput, 'bookId'>;
    if (
      typeof body.chapterIndex !== 'number' ||
      typeof body.start !== 'number' ||
      typeof body.end !== 'number' ||
      body.end <= body.start ||
      !body.passage
    ) {
      return NextResponse.json(
        { error: 'chapterIndex, start < end, and passage are required' },
        { status: 400 },
      );
    }
    const annotation = await repository.createAnnotation({
      bookId,
      kind: body.note ? 'note' : 'highlight',
      chapterIndex: body.chapterIndex,
      start: body.start,
      end: body.end,
      passage: body.passage,
      note: body.note,
      color: body.color ?? 'yellow',
      chapterTitle: body.chapterTitle,
    });
    return NextResponse.json({ annotation }, { status: 201 });
  } catch (error) {
    return asResponse(error);
  }
}
