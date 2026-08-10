import { NextResponse } from 'next/server';
import { getRepository, UnauthorizedError } from '@/lib/data';

/**
 * GET /api/wallet — the signed-in reader's coin balance ({ balance }).
 * Anonymous visitors get { balance: 0 } (200, not 401) so wallet chrome can
 * call it unconditionally.
 */
export async function GET() {
  try {
    const repository = await getRepository();
    const wallet = await repository.getWallet();
    return NextResponse.json({ balance: wallet.balance });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ balance: 0 });
    return NextResponse.json({ balance: 0 });
  }
}
