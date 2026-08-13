'use client';

import { useState } from 'react';
import type { BookVisibility, PublicationStatus } from '@inkread/core';

/**
 * Owner control to publish a book to the public discovery site, mark whether it
 * is still ongoing or completed, and price it (a free head of N chapters, then a
 * flat per-chapter coin price). Optimistic; reverts on failure.
 */
export function PublishControl({
  bookId,
  visibility: initialVisibility,
  status: initialStatus,
  freeChapterCount: initialFree,
  coinsPerChapter: initialPrice,
}: {
  bookId: string;
  visibility: BookVisibility;
  status: PublicationStatus;
  freeChapterCount: number;
  coinsPerChapter: number;
}) {
  const [visibility, setVisibility] = useState<BookVisibility>(initialVisibility);
  const [status, setStatus] = useState<PublicationStatus>(initialStatus);
  // Pricing lives in state (not the props) so the label updates after a save —
  // the page is a server component, so the props never refresh in place.
  const [freeCount, setFreeCount] = useState(initialFree);
  const [coinPrice, setCoinPrice] = useState(initialPrice);
  const [busy, setBusy] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  async function patch(update: {
    visibility?: BookVisibility;
    status?: PublicationStatus;
    freeChapterCount?: number;
    coinsPerChapter?: number;
  }): Promise<boolean> {
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
      return true;
    } catch {
      setVisibility(prev.visibility);
      setStatus(prev.status);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const isPublic = visibility === 'public';

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {isPublic ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPricingOpen((o) => !o)}
              className="rounded-full border border-[#e6dfd4] px-2.5 py-1 text-xs font-medium text-[#8b5e3c] transition hover:bg-[#f3ead9] disabled:opacity-50"
              title="Set the free chapters and per-chapter price"
            >
              {coinPrice > 0 ? `${coinPrice} coins/ch` : 'Free · price it'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ status: status === 'ongoing' ? 'completed' : 'ongoing' })}
              className="rounded-full border border-[#e6dfd4] px-2.5 py-1 text-xs font-medium text-[#4a5d4e] transition hover:bg-[#eef4ee] disabled:opacity-50"
              title="Toggle whether the series is still being written"
            >
              {status === 'ongoing' ? 'Ongoing' : 'Completed'}
            </button>
          </>
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

      {isPublic && pricingOpen ? (
        <PricingEditor
          busy={busy}
          initialFree={freeCount}
          initialPrice={coinPrice}
          onSave={async (freeChapterCount, coinsPerChapter) => {
            const ok = await patch({ freeChapterCount, coinsPerChapter });
            if (ok) {
              setFreeCount(freeChapterCount);
              setCoinPrice(coinsPerChapter);
              setPricingOpen(false);
            }
            return ok;
          }}
        />
      ) : null}
    </div>
  );
}

function PricingEditor({
  busy,
  initialFree,
  initialPrice,
  onSave,
}: {
  busy: boolean;
  initialFree: number;
  initialPrice: number;
  onSave: (freeChapterCount: number, coinsPerChapter: number) => Promise<boolean>;
}) {
  const [free, setFree] = useState(String(initialFree));
  const [price, setPrice] = useState(String(initialPrice));

  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#e6dfd4] bg-white/70 p-2 text-xs">
      <label className="flex items-center gap-1 text-[#6b6459]">
        Free
        <input
          type="number"
          min={0}
          value={free}
          onChange={(e) => setFree(e.target.value)}
          className="w-14 rounded-md border border-[#e0d8ca] px-1.5 py-0.5 tabular-nums"
        />
      </label>
      <label className="flex items-center gap-1 text-[#6b6459]">
        Coins/ch
        <input
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-14 rounded-md border border-[#e0d8ca] px-1.5 py-0.5 tabular-nums"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          onSave(Math.max(0, Number.parseInt(free, 10) || 0), Math.max(0, Number.parseInt(price, 10) || 0))
        }
        className="rounded-full bg-[#8b5e3c] px-2.5 py-1 font-medium text-white transition hover:bg-[#7a5133] disabled:opacity-50"
      >
        Save
      </button>
    </div>
  );
}
