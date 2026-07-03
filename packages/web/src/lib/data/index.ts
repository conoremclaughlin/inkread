import { NextResponse } from 'next/server';
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
 * Throws UnauthorizedError when there is no session — route handlers
 * translate that via `asResponse`.
 */
export async function getRepository(): Promise<LibraryRepository> {
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
