import { NextResponse } from 'next/server';
import type { VoiceCast } from '@inkread/core';
import { asResponse, getRepository } from '@/lib/data';

type Params = { params: Promise<{ bookId: string }> };

/** GET /api/books/:bookId/voice-cast — the book's multi-voice cast (or null). */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const repository = await getRepository();
    return NextResponse.json({ cast: (await repository.getVoiceCast(bookId)) ?? null });
  } catch (error) {
    return asResponse(error);
  }
}

/** PUT /api/books/:bookId/voice-cast — upsert the cast (owner only, via RLS). */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { bookId } = await params;
    const body = (await request.json()) as Partial<VoiceCast>;
    const cast: VoiceCast = {
      bookId,
      speakers: Array.isArray(body.speakers) ? body.speakers : [],
      rules: Array.isArray(body.rules) ? body.rules : [],
      defaultSpeakerId: typeof body.defaultSpeakerId === 'string' ? body.defaultSpeakerId : '',
    };
    const repository = await getRepository();
    await repository.saveVoiceCast(cast);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return asResponse(error);
  }
}
