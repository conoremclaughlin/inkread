import { NextResponse } from 'next/server';
import { getRepository, UnauthorizedError } from '@/lib/data';

/**
 * GET /api/comments/my-votes?ids=a,b,c — the signed-in reader's own vote on
 * each comment ({ [commentId]: 1 | -1 }). Anonymous visitors get an empty map
 * (200, not 401) so the public comment board can call it unconditionally.
 */
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const repository = await getRepository();
    const votes = await repository.listMyVotes(ids);
    return NextResponse.json({ votes });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ votes: {} });
    return NextResponse.json({ votes: {} });
  }
}
