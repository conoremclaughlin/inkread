'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { Comment } from '@inkread/core';
import { relativeTime } from '@/lib/relativeTime';

export interface CommentsColors {
  bg: string;
  fg: string;
  accent: string;
  muted: string;
  border: string;
}

interface Props {
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  /** Own comments get a delete affordance; RLS enforces it server-side too. */
  currentUserId?: string;
  open: boolean;
  onClose: () => void;
  colors: CommentsColors;
}

/**
 * A right-hand slide-out of reader comments for the current chapter, with a
 * composer. Reads/writes the /api/books/:id/comments endpoints (integration-
 * tested). Reloads on open and whenever the chapter changes.
 */
export function CommentsDrawer({
  bookId,
  chapterIndex,
  chapterTitle,
  currentUserId,
  open,
  onClose,
  colors,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/books/${bookId}/comments?chapter=${chapterIndex}`);
      if (!res.ok) throw new Error('Could not load comments.');
      setComments(((await res.json()) as { comments: Comment[] }).comments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load comments.');
    } finally {
      setLoading(false);
    }
  }, [bookId, chapterIndex]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/books/${bookId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterIndex, body }),
      });
      if (!res.ok) throw new Error('Could not post your comment.');
      const { comment } = (await res.json()) as { comment: Comment };
      setComments((prev) => [...prev, comment]);
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post your comment.');
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id: string) => {
    const prev = comments;
    setComments((cs) => cs.filter((c) => c.id !== id)); // optimistic
    const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' }).catch(() => undefined);
    if (!res || !res.ok) setComments(prev); // restore on failure
  };

  if (!open) return null;

  const panel: CSSProperties = {
    background: colors.bg,
    color: colors.fg,
    borderColor: colors.border,
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        className="relative flex h-full w-[min(92vw,26rem)] flex-col border-l shadow-2xl"
        style={panel}
        aria-label="Comments"
      >
        <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: colors.border }}>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Comments</p>
            <p className="truncate text-xs" style={{ color: colors.muted }}>
              {chapterTitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm transition hover:opacity-70"
            style={{ color: colors.muted }}
            aria-label="Close comments"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && comments.length === 0 ? (
            <p className="text-sm" style={{ color: colors.muted }}>
              Loading…
            </p>
          ) : comments.length === 0 ? (
            <p className="text-sm" style={{ color: colors.muted }}>
              No comments yet. Start the conversation about this chapter.
            </p>
          ) : (
            <ul className="space-y-4">
              {comments.map((c) => (
                <li key={c.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{c.authorName ?? 'Reader'}</span>
                    <span className="shrink-0 text-xs" style={{ color: colors.muted }}>
                      {relativeTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
                  {currentUserId && c.authorId === currentUserId ? (
                    <button
                      onClick={() => void remove(c.id)}
                      className="mt-1 text-xs transition hover:opacity-70"
                      style={{ color: colors.muted }}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t px-5 py-4" style={{ borderColor: colors.border }}>
          {error ? (
            <p className="mb-2 text-xs" style={{ color: '#b3402a' }}>
              {error}
            </p>
          ) : null}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment…"
            rows={3}
            maxLength={4000}
            className="w-full resize-none rounded-lg border bg-transparent p-3 text-sm outline-none"
            style={{ borderColor: colors.border, color: colors.fg }}
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => void submit()}
              disabled={posting || draft.trim().length === 0}
              className="rounded-full px-4 py-2 text-sm font-semibold transition hover:opacity-90 disabled:opacity-40"
              style={{ background: colors.accent, color: colors.bg }}
            >
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
