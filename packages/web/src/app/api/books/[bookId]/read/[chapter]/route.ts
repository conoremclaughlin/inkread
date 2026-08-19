import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getRepository } from '@/lib/data';
import { getPublicChapter } from '@/lib/data/public';

type Params = { params: Promise<{ bookId: string; chapter: string }> };

/**
 * GET /api/books/:bookId/read/:chapter — one chapter through the entitlement
 * gate, for whoever is asking.
 *
 * Signed in, the repository answers (owner, free head, or a recorded unlock);
 * anonymous, the session-less public client answers under the public RLS
 * policies. Either way a chapter the reader isn't entitled to comes back
 * `locked` with its price and NO body, so the reader can render a paywall
 * without ever holding the text.
 *
 * This is what lets the reader load chapters lazily instead of being handed a
 * whole book up front — the public reader can't be, and shouldn't be.
 */
export async function GET(_request: Request, { params }: Params) {
  const { bookId, chapter } = await params;
  const index = Number.parseInt(chapter, 10);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: 'Bad chapter index' }, { status: 400 });
  }

  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }

  try {
    const read = signedIn
      ? await (await getRepository()).readChapter(bookId, index)
      : await getPublicChapter(bookId, index);
    if (!read) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ chapter: read });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
