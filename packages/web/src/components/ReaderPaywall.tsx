'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The paywall shown in place of a locked chapter's body. A signed-in reader can
 * spend coins to unlock just this chapter or the rest of the book, and top up
 * (demo coins) when short. Anonymous visitors are sent to sign in. On a
 * successful unlock we refresh the server component, which then renders the body.
 */
export function ReaderPaywall({
  bookId,
  chapterIndex,
  coinCost,
  signedIn,
  balance,
  remainingCount,
  remainingBookCost,
}: {
  bookId: string;
  chapterIndex: number;
  coinCost: number;
  signedIn: boolean;
  balance: number;
  remainingCount: number;
  remainingBookCost: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'chapter' | 'book' | 'topup'>(null);
  const [error, setError] = useState<string | null>(null);

  const canAffordChapter = balance >= coinCost;

  async function unlock(kind: 'chapter' | 'book') {
    if (!signedIn) {
      window.location.href = '/login';
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'chapter' ? { chapterIndex } : {}),
      });
      if (res.status === 402) {
        setError('Not enough coins — top up below.');
        setBusy(null);
        return;
      }
      if (!res.ok) throw new Error('unlock failed');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setBusy(null);
    }
  }

  async function topUp() {
    setBusy('topup');
    setError(null);
    try {
      const res = await fetch('/api/wallet/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 100 }),
      });
      if (!res.ok) throw new Error('top-up failed');
      router.refresh();
    } catch {
      setError('Top-up failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="my-8 rounded-2xl border border-[#e6dfd4] bg-gradient-to-b from-white to-[#fbf7f0] p-8 text-center shadow-sm">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f3ead9] text-[#8b5e3c]"
        aria-hidden
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </div>
      <h2 className="mt-4 font-serif text-xl text-[#26221c]">This chapter is locked</h2>
      <p className="mt-1 text-[15px] text-[#6b6459]">
        Unlock it with coins to keep reading — it&apos;s yours for good, in text and audio.
      </p>

      {signedIn ? (
        <p className="mt-4 text-sm text-[#8a8175]">
          Your balance: <span className="font-semibold text-[#26221c]">{balance}</span> coins
        </p>
      ) : null}

      <div className="mt-5 flex flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={() => unlock('chapter')}
          disabled={busy !== null}
          className="w-full max-w-xs rounded-full bg-[#8b5e3c] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#7a5133] disabled:opacity-60"
        >
          {busy === 'chapter'
            ? 'Unlocking…'
            : signedIn
              ? `Unlock this chapter — ${coinCost} coins`
              : `Sign in to unlock — ${coinCost} coins`}
        </button>

        {signedIn && remainingCount > 1 ? (
          <button
            type="button"
            onClick={() => unlock('book')}
            disabled={busy !== null}
            className="w-full max-w-xs rounded-full border border-[#d9cdb9] bg-white px-5 py-2.5 text-sm font-medium text-[#6b4a2e] transition hover:border-[#8b5e3c] disabled:opacity-60"
          >
            {busy === 'book'
              ? 'Unlocking…'
              : `Unlock all ${remainingCount} remaining — ${remainingBookCost} coins`}
          </button>
        ) : null}

        {signedIn && !canAffordChapter ? (
          <button
            type="button"
            onClick={topUp}
            disabled={busy !== null}
            className="mt-1 text-sm font-medium text-[#8b5e3c] underline-offset-2 hover:underline disabled:opacity-60"
          >
            {busy === 'topup' ? 'Adding coins…' : '+100 demo coins'}
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-[#9a5b4f]">{error}</p> : null}
    </div>
  );
}
