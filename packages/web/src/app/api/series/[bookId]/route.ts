import { NextResponse } from 'next/server';
import { getPublicSeries } from '@/lib/data/public';

type Params = { params: Promise<{ bookId: string }> };

/**
 * GET /api/series/:bookId — public series detail (work, TOC, ranked comments).
 * No auth; mirrors the /series page data for non-web clients (mobile discovery).
 */
export async function GET(_request: Request, { params }: Params) {
  const { bookId } = await params;
  const detail = await getPublicSeries(bookId);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}
