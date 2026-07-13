import { NextResponse } from 'next/server';
import { asResponse, getRepository } from '@/lib/data';
import type { ReaderPreferences } from '@/lib/data/repository';

export async function GET() {
  try {
    const repository = await getRepository();
    return NextResponse.json({ preferences: await repository.getPreferences() });
  } catch (error) {
    return asResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const repository = await getRepository();
    const patch = (await request.json()) as ReaderPreferences;
    await repository.savePreferences(patch);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return asResponse(error);
  }
}
