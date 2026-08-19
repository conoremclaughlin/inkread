'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface PaywallColors {
  bg: string;
  fg: string;
  accent: string;
  muted: string;
  border: string;
}

/**
 * The paywall shown in place of a locked chapter's body. A signed-in reader can
 * spend coins to unlock just this chapter or the rest of the book, and top up
 * (demo coins) when short. Anonymous visitors are sent to sign in.
 *
 * After a successful purchase it calls `onUnlocked` when given one — that's how
 * the in-reader paywall swaps itself for the text without a page reload — and
 * otherwise refreshes the server component it was rendered by.
 */
export function ReaderPaywall({
  bookId,
  chapterIndex,
  coinCost,
  signedIn,
  balance,
  remainingCount,
  remainingBookCost,
  colors,
  onUnlocked,
}: {
  bookId: string;
  chapterIndex: number;
  coinCost: number;
  signedIn: boolean;
  balance: number;
  remainingCount: number;
  remainingBookCost: number;
  /** Reader theme, when embedded in the reader; omitted on the public page. */
  colors?: PaywallColors;
  onUnlocked?: () => void | Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'chapter' | 'book' | 'topup'>(null);
  const [error, setError] = useState<string | null>(null);

  const canAffordChapter = balance >= coinCost;

  async function settled() {
    if (onUnlocked) await onUnlocked();
    else router.refresh();
  }

  async function unlock(kind: 'chapter' | 'book') {
    if (!signedIn) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
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
      await settled();
      setBusy(null);
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
      await settled();
    } catch {
      setError('Top-up failed. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  // Embedded in the reader the panel wears the reading theme (a cream card on
  // a night page would be a flashbang); on the public page it keeps the site's
  // own palette.
  const themed = Boolean(colors);
  const cardStyle = colors
    ? { background: colors.bg, color: colors.fg, borderColor: colors.border }
    : undefined;
  const accentStyle = colors ? { background: colors.accent, color: colors.bg } : undefined;
  const mutedStyle = colors ? { color: colors.muted } : undefined;
  const outlineStyle = colors
    ? { borderColor: colors.border, color: colors.accent, background: 'transparent' }
    : undefined;

  return (
    <div
      className={`my-8 rounded-2xl border p-8 text-center shadow-sm ${
        themed ? '' : 'border-[#e6dfd4] bg-gradient-to-b from-white to-[#fbf7f0]'
      }`}
      style={cardStyle}
    >
      <div
        className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
          themed ? '' : 'bg-[#f3ead9] text-[#8b5e3c]'
        }`}
        style={
          colors
            ? { background: `color-mix(in srgb, ${colors.accent} 18%, transparent)`, color: colors.accent }
            : undefined
        }
        aria-hidden
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </div>
      <h2 className={`mt-4 font-serif text-xl ${themed ? '' : 'text-[#26221c]'}`}>
        This chapter is locked
      </h2>
      <p className={`mt-1 text-[15px] ${themed ? '' : 'text-[#6b6459]'}`} style={mutedStyle}>
        Unlock it with coins to keep reading — it&apos;s yours for good, in text and audio.
      </p>

      {signedIn ? (
        <p className={`mt-4 text-sm ${themed ? '' : 'text-[#8a8175]'}`} style={mutedStyle}>
          Your balance: <span className="font-semibold">{balance}</span> coins
        </p>
      ) : null}

      <div className="mt-5 flex flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={() => unlock('chapter')}
          disabled={busy !== null}
          className={`w-full max-w-xs rounded-full px-5 py-3 text-sm font-medium transition disabled:opacity-60 ${
            themed ? 'hover:opacity-90' : 'bg-[#8b5e3c] text-white hover:bg-[#7a5133]'
          }`}
          style={accentStyle}
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
            className={`w-full max-w-xs rounded-full border px-5 py-2.5 text-sm font-medium transition disabled:opacity-60 ${
              themed ? 'hover:opacity-80' : 'border-[#d9cdb9] bg-white text-[#6b4a2e] hover:border-[#8b5e3c]'
            }`}
            style={outlineStyle}
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
            className={`mt-1 text-sm font-medium underline-offset-2 hover:underline disabled:opacity-60 ${
              themed ? '' : 'text-[#8b5e3c]'
            }`}
            style={colors ? { color: colors.accent } : undefined}
          >
            {busy === 'topup' ? 'Adding coins…' : '+100 demo coins'}
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-[#c2705f]">{error}</p> : null}
    </div>
  );
}
