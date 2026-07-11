import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '../supabase/server';
import type { LibraryRepository } from './repository';
import { SupabaseLibraryRepository } from './supabase-repository';

export type { BookSummary, CreateAnnotationInput, CreateBookInput, LibraryRepository } from './repository';

export class UnauthorizedError extends Error {
  constructor() {
    super('Not authenticated');
  }
}

/**
 * Resolve the session user and hand back the repository for them.
 * Accepts either the cookie session (web app) or a Bearer access token
 * (scripts, the mobile app). Throws UnauthorizedError when neither is
 * valid — route handlers translate that via `asResponse`.
 */
export async function getRepository(): Promise<LibraryRepository> {
  const authorization = (await headers()).get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length);
    // RLS enforces per-user access as long as the client carries the JWT.
    const supabase = createSupabaseClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) throw new UnauthorizedError();
    return new SupabaseLibraryRepository(supabase, user.id);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();
  return new SupabaseLibraryRepository(supabase, user.id);
}

/** Uniform error → HTTP mapping for route handlers. */
export function asResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  return NextResponse.json({ error: message }, { status: 500 });
}
