'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * The ⋯ menu on a library card: everything that isn't "open the book",
 * with destructive actions gated behind an explicit confirmation modal.
 */
export function BookActions({ bookId, title }: { bookId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const item =
    'block w-full rounded-lg px-3 py-2 text-left text-sm text-[#26221c] hover:bg-[#faf7f2]';

  return (
    <div className="relative flex items-center">
      <button
        aria-label={`Options for ${title}`}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="rounded-full px-3 py-2 text-lg leading-none text-[#6b6459] hover:bg-[#faf7f2] hover:text-[#26221c]"
      >
        ⋯
      </button>

      {open ? (
        <>
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-10 z-20 w-48 rounded-xl border border-[#e6dfd4] bg-white p-1.5 shadow-lg">
            <Link href={`/notes/${bookId}`} className={item}>
              Notes
            </Link>
            <a href={`/api/books/${bookId}/export?format=markdown`} className={item}>
              Export Markdown
            </a>
            <a href={`/api/books/${bookId}/export?format=epub`} className={item}>
              Download EPUB
            </a>
            <hr className="my-1 border-[#e6dfd4]" />
            <button
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[#b3402a] hover:bg-[#fdf1ee]"
            >
              Delete book…
            </button>
          </div>
        </>
      ) : null}

      {confirming ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-[#26221c] shadow-2xl">
            <h2 className="font-serif text-lg">Delete “{title}”?</h2>
            <p className="mt-2 text-sm text-[#6b6459]">
              This permanently removes the book, its highlights, notes, and reading position.
              There is no undo.
            </p>
            <div className="mt-4 flex justify-end gap-3 text-sm">
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-2 text-[#6b6459]"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDeleting(true);
                  await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
                  setConfirming(false);
                  setDeleting(false);
                  router.refresh();
                }}
                disabled={deleting}
                className="rounded-full bg-[#b3402a] px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
