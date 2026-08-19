import { NextResponse } from 'next/server';
import { listPublicSeries } from '@/lib/data/public';

/**
 * GET /api/discover?status=ongoing|completed&q=term — public serials for
 * discovery. No auth (runs as the anon role under public RLS), so the mobile
 * app and any client can browse published works without a session.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam === 'ongoing' || statusParam === 'completed' ? statusParam : undefined;
  const query = url.searchParams.get('q') ?? undefined;
  const series = await listPublicSeries({ status, query });
  return NextResponse.json({ series });
}
