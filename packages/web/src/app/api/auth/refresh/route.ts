import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/** Exchange a refresh token for fresh Bearer credentials. */
export async function POST(request: Request) {
  const { refreshToken } = (await request.json()) as { refreshToken?: string };
  if (!refreshToken) {
    return NextResponse.json({ error: 'refreshToken required' }, { status: 400 });
  }
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    return NextResponse.json({ error: error?.message ?? 'Refresh failed' }, { status: 401 });
  }
  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
}
