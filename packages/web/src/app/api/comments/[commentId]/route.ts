import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ commentId: string }> };

/** DELETE /api/comments/:commentId — author-only (enforced by RLS). */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { commentId } = await params;
    const repository = await getRepository();
    await repository.deleteComment(commentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return asResponse(error);
  }
}
