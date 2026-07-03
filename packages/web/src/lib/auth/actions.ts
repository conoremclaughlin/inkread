'use server';

import { redirect } from 'next/navigation';
import { createClient } from '../supabase/server';

type AuthResult = { success: true } | { error: string };

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { success: true };
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.APP_URL ?? 'http://127.0.0.1:6021'}/auth/callback`,
    },
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
