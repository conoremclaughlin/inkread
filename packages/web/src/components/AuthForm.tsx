'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signInWithPassword, signUpWithPassword } from '@/lib/auth/actions';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const action = mode === 'login' ? signInWithPassword : signUpWithPassword;
    const result = await action(email, password);
    if ('error' in result) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[#e6dfd4] bg-white p-8 shadow-sm">
        <h1 className="font-serif text-3xl">inkread</h1>
        <p className="mt-1 text-sm text-[#6b6459]">
          {mode === 'login' ? 'Welcome back to your library.' : 'Create your library.'}
        </p>
        <label className="mt-6 block text-sm font-medium">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#e6dfd4] px-3 py-2 outline-none focus:border-[#8b5e3c]"
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#e6dfd4] px-3 py-2 outline-none focus:border-[#8b5e3c]"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-[#b3402a]">{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-lg bg-[#8b5e3c] py-2.5 font-semibold text-white transition hover:bg-[#75492c] disabled:opacity-50"
        >
          {pending ? '…' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>
        <p className="mt-4 text-center text-sm text-[#6b6459]">
          {mode === 'login' ? (
            <>
              No account?{' '}
              <Link href="/signup" className="font-medium text-[#8b5e3c]">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Have an account?{' '}
              <Link href="/login" className="font-medium text-[#8b5e3c]">
                Log in
              </Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
