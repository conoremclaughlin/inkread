import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ annotationId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { annotationId } = await params;
    const repository = await getRepository();
    const body = (await request.json()) as { note?: string | null };
    await repository.updateAnnotationNote(
      annotationId,
      body.note?.trim() ? body.note.trim() : undefined,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return asResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { annotationId } = await params;
    const repository = await getRepository();
    await repository.deleteAnnotation(annotationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return asResponse(error);
  }
}
