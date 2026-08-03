import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ commentId: string }> };

/**
 * POST /api/comments/:commentId/vote — { value: 1 | -1 | 0 }.
 * +1/−1 casts or changes the vote; 0 clears it. Sign-in required (RLS also
 * restricts voting to comments the user can see).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { commentId } = await params;
    const { value } = (await request.json()) as { value?: number };
    if (value !== 1 && value !== -1 && value !== 0) {
      return NextResponse.json({ error: 'value must be 1, -1, or 0' }, { status: 400 });
    }
    const repository = await getRepository();
    await repository.voteOnComment(commentId, value);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return asResponse(error);
  }
}
