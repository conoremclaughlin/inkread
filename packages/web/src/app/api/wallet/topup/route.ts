import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';

/**
 * POST /api/wallet/topup — { amount } demo coins into the signed-in wallet
 * (no real charge). Returns the new { balance }. A real payment provider will
 * later credit the same wallet server-side; this is the demo funding path.
 */
export async function POST(request: Request) {
  try {
    const { amount } = (await request.json()) as { amount?: number };
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
    }
    const repository = await getRepository();
    const balance = await repository.topUpDemo(Math.floor(amount));
    return NextResponse.json({ balance });
  } catch (error) {
    return asResponse(error);
  }
}
