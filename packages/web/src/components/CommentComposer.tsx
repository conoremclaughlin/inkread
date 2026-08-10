'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * Post a comment on the chapter you're reading. Signed-in readers only; anon
 * visitors get a sign-in nudge. Refreshes the server component on success so the
 * new comment appears in the (score-ranked) board below.
 */
export function CommentComposer({
  bookId,
  chapterIndex,
  signedIn,
}: {
  bookId: string;
  chapterIndex: number;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <p className="mb-5 rounded-2xl border border-dashed border-[#e0d8ca] bg-[#fbf8f2] px-5 py-4 text-center text-sm text-[#8a8175]">
        <Link href="/login" className="font-medium text-[#8b5e3c] hover:underline">
          Sign in
        </Link>{' '}
        to join the discussion.
      </p>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterIndex, body: text }),
      });
      if (!res.ok) throw new Error('post failed');
      setBody('');
      router.refresh();
    } catch {
      setError('Could not post your comment. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-5">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
        rows={3}
        placeholder="Share your thoughts on this chapter…"
        className="w-full resize-y rounded-2xl border border-[#e6dfd4] bg-white px-4 py-3 text-[15px] leading-relaxed text-[#332e26] outline-none transition focus:border-[#8b5e3c]"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-[#a49a8b]">
          {error ?? `${body.trim().length}/4000`}
        </span>
        <button
          type="submit"
          disabled={busy || body.trim().length === 0}
          className="shrink-0 rounded-full bg-[#8b5e3c] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#7a5133] disabled:opacity-50"
        >
          {busy ? 'Posting…' : 'Post comment'}
        </button>
      </div>
    </form>
  );
}
