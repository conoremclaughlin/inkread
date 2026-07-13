'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { googleDocToChapters, textToChapters, type Chapter } from '@inkread/core';

/** Numeric-aware filename sort so "678 …" sorts before "1029 …". */
function byLeadingNumber(a: File, b: File): number {
  const na = parseInt(a.name, 10);
  const nb = parseInt(b.name, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.name.localeCompare(b.name);
}

/**
 * The ⋯ menu on a library card: everything that isn't "open the book",
 * with destructive actions gated behind an explicit confirmation modal.
 */
export function BookActions({ bookId, title }: { bookId: string; title: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>();
  const [placement, setPlacement] = useState<'auto' | 'end'>('auto');
  const [adding, setAdding] = useState(false);

  const addChapters = async () => {
    if (!pendingFiles) return;
    setAdding(true);
    try {
      const chapters: Chapter[] = [];
      for (const file of pendingFiles) {
        const raw = await file.text();
        const name = file.name.replace(/\.(txt|md|markdown)$/i, '');
        const parsed = /\.(md|markdown)$/i.test(file.name)
          ? textToChapters(raw, name, { headings: 'markdown' })
          : googleDocToChapters(raw, name);
        chapters.push(...parsed);
      }
      const response = await fetch(`/api/books/${bookId}/chapters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapters, placement }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setPendingFiles(undefined);
      router.refresh();
    } catch (error) {
      alert(`Adding chapters failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAdding(false);
    }
  };

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
            <Link href={`/read/${bookId}?from=start`} className={item}>
              Read from beginning
            </Link>
            <button
              onClick={() => {
                setOpen(false);
                fileInputRef.current?.click();
              }}
              className={item}
            >
              Add chapters…
            </button>
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

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.markdown,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].sort(byLeadingNumber);
          if (files.length > 0) setPendingFiles(files);
          e.target.value = '';
        }}
      />

      {pendingFiles ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 text-[#26221c] shadow-2xl">
            <h2 className="font-serif text-lg">
              Add {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} to “{title}”
            </h2>
            <ul className="mt-3 max-h-40 overflow-auto rounded-lg border border-[#e6dfd4] p-2 text-xs text-[#6b6459]">
              {pendingFiles.map((file) => (
                <li key={file.name} className="truncate py-0.5">
                  {file.name}
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={placement === 'auto'}
                  onChange={() => setPlacement('auto')}
                />
                Place by chapter number (for out-of-order arrivals)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={placement === 'end'}
                  onChange={() => setPlacement('end')}
                />
                Add to the end
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-3 text-sm">
              <button
                onClick={() => setPendingFiles(undefined)}
                className="px-3 py-2 text-[#6b6459]"
                disabled={adding}
              >
                Cancel
              </button>
              <button
                onClick={() => void addChapters()}
                disabled={adding}
                className="rounded-full bg-[#8b5e3c] px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                {adding ? 'Adding…' : 'Add chapters'}
              </button>
            </div>
          </div>
        </div>
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
