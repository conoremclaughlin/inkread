'use client';

import { useState } from 'react';
import type { BookVisibility, PublicationStatus } from '@inkread/core';

/**
 * Owner control to publish a book to the public discovery site and mark whether
 * it is still ongoing or completed. Optimistic; reverts on failure.
 */
export function PublishControl({
  bookId,
  visibility: initialVisibility,
  status: initialStatus,
}: {
  bookId: string;
  visibility: BookVisibility;
  status: PublicationStatus;
}) {
  const [visibility, setVisibility] = useState<BookVisibility>(initialVisibility);
  const [status, setStatus] = useState<PublicationStatus>(initialStatus);
  const [busy, setBusy] = useState(false);

  async function patch(update: { visibility?: BookVisibility; status?: PublicationStatus }) {
    setBusy(true);
    const prev = { visibility, status };
    if (update.visibility) setVisibility(update.visibility);
    if (update.status) setStatus(update.status);
    try {
      const res = await fetch(`/api/books/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error('patch failed');
    } catch {
      setVisibility(prev.visibility);
      setStatus(prev.status);
    } finally {
      setBusy(false);
    }
  }

  const isPublic = visibility === 'public';

  return (
    <div className="flex items-center gap-2">
      {isPublic ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => patch({ status: status === 'ongoing' ? 'completed' : 'ongoing' })}
          className="rounded-full border border-[#e6dfd4] px-2.5 py-1 text-xs font-medium text-[#4a5d4e] transition hover:bg-[#eef4ee] disabled:opacity-50"
          title="Toggle whether the series is still being written"
        >
          {status === 'ongoing' ? 'Ongoing' : 'Completed'}
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => patch({ visibility: isPublic ? 'private' : 'public' })}
        className={
          isPublic
            ? 'rounded-full px-3 py-1 text-xs font-medium text-[#6b6459] transition hover:bg-[#f0e6da] disabled:opacity-50'
            : 'rounded-full bg-[#8b5e3c] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#7a5133] disabled:opacity-50'
        }
        title={isPublic ? 'Make this book private again' : 'Publish this book to the public site'}
      >
        {isPublic ? 'Published' : 'Publish'}
      </button>
    </div>
  );
}
