'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PublicComment } from '@/lib/data/public';
import { relativeTime } from '@/lib/relativeTime';

type Vote = 1 | -1 | 0;

interface Row {
  score: number;
  myVote: Vote;
}

/**
 * Publicly-readable discussion, ranked by net score. Anyone can read; voting
 * needs a session (anonymous clicks bounce to sign-in). The server hands us the
 * comments already score-sorted; we keep that order stable during a visit and
 * only animate the score in place, so a vote never makes the list jump.
 */
export function CommentsBoard({
  comments,
  signedIn,
  showSeries = false,
}: {
  comments: PublicComment[];
  signedIn: boolean;
  showSeries?: boolean;
}) {
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(comments.map((c) => [c.id, { score: c.score, myVote: 0 as Vote }])),
  );

  // Light up the reader's own votes once we know who they are.
  useEffect(() => {
    if (!signedIn || comments.length === 0) return;
    const ids = comments.map((c) => c.id).join(',');
    let cancelled = false;
    fetch(`/api/comments/my-votes?ids=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((data: { votes: Record<string, 1 | -1> }) => {
        if (cancelled) return;
        setRows((prev) => {
          const next = { ...prev };
          for (const [id, value] of Object.entries(data.votes ?? {})) {
            if (next[id]) next[id] = { ...next[id]!, myVote: value };
          }
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn, comments]);

  async function vote(commentId: string, direction: 1 | -1) {
    if (!signedIn) {
      window.location.href = '/login';
      return;
    }
    const current = rows[commentId];
    if (!current) return;
    const nextVote: Vote = current.myVote === direction ? 0 : direction;
    const delta = nextVote - current.myVote; // −2..+2
    const optimistic: Row = { score: current.score + delta, myVote: nextVote };
    setRows((prev) => ({ ...prev, [commentId]: optimistic }));
    try {
      const res = await fetch(`/api/comments/${commentId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: nextVote }),
      });
      if (!res.ok) throw new Error('vote failed');
    } catch {
      setRows((prev) => ({ ...prev, [commentId]: current })); // revert
    }
  }

  if (comments.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[#e0d8ca] bg-[#fbf8f2] px-6 py-10 text-center text-[#8a8175]">
        No comments yet — be the first to start the conversation.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {comments.map((comment) => {
        const row = rows[comment.id] ?? { score: comment.score, myVote: 0 };
        return (
          <li
            key={comment.id}
            className="flex gap-4 rounded-2xl border border-[#e6dfd4] bg-white p-4"
          >
            <div className="flex w-10 shrink-0 flex-col items-center pt-0.5">
              <VoteArrow
                dir="up"
                active={row.myVote === 1}
                onClick={() => vote(comment.id, 1)}
              />
              <span
                className={`my-0.5 text-sm font-semibold tabular-nums ${
                  row.myVote === 1
                    ? 'text-[#4a5d4e]'
                    : row.myVote === -1
                      ? 'text-[#9a5b4f]'
                      : 'text-[#26221c]'
                }`}
              >
                {row.score}
              </span>
              <VoteArrow
                dir="down"
                active={row.myVote === -1}
                onClick={() => vote(comment.id, -1)}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[#332e26]">
                {comment.body}
              </p>
              <p className="mt-2 text-xs text-[#8a8175]">
                <span className="font-medium text-[#6b6459]">
                  {comment.authorName || 'Reader'}
                </span>
                {' · '}
                {relativeTime(comment.createdAt)}
                {showSeries ? (
                  <>
                    {' · on '}
                    <Link
                      href={`/series/${comment.bookId}`}
                      className="font-medium text-[#8b5e3c] hover:underline"
                    >
                      {comment.seriesTitle}
                    </Link>
                  </>
                ) : (
                  <> · Chapter {comment.chapterIndex + 1}</>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function VoteArrow({
  dir,
  active,
  onClick,
}: {
  dir: 'up' | 'down';
  active: boolean;
  onClick: () => void;
}) {
  const activeColor = dir === 'up' ? '#4a5d4e' : '#9a5b4f';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === 'up' ? 'Upvote' : 'Downvote'}
      aria-pressed={active}
      className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-[#f0e6da]"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        <path
          d={dir === 'up' ? 'M7 3 L12 10 L2 10 Z' : 'M7 11 L2 4 L12 4 Z'}
          fill={active ? activeColor : 'none'}
          stroke={active ? activeColor : '#b3a89a'}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
