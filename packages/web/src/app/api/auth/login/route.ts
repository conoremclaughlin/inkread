import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Token login for non-browser clients (mobile, scripts). Browsers use the
 * cookie-session flow; this returns Bearer credentials for apiFetch-style
 * access, keeping clients pointed at our API rather than the auth provider.
 */
export async function POST(request: Request) {
  const { email, password } = (await request.json()) as { email?: string; password?: string };
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return NextResponse.json({ error: error?.message ?? 'Login failed' }, { status: 401 });
  }
  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
    user: { id: data.user!.id, email: data.user!.email },
  });
}
