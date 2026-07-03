'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { segmentPages } from '@inkread/core';
import { extractPdfPages } from '@/lib/pdf/extract';

export function ImportPdf() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string>();

  const handleFile = async (file: File) => {
    try {
      setStatus('Reading PDF…');
      const buffer = await file.arrayBuffer();
      const { pages, title, author } = await extractPdfPages(buffer, (done, total) =>
        setStatus(`Extracting page ${done} of ${total}…`),
      );
      setStatus('Segmenting chapters…');
      const chapters = segmentPages(pages);
      if (chapters.length === 0) {
        setStatus(undefined);
        alert('No readable text found — this may be a scanned PDF without embedded text.');
        return;
      }
      setStatus('Saving to your library…');
      const response = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: (title ?? '').trim() || file.name.replace(/\.pdf$/i, ''),
          author: (author ?? '').trim() || undefined,
          source: 'pdf',
          chapters,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const { book } = (await response.json()) as { book: { id: string } };
      setStatus(undefined);
      router.push(`/read/${book.id}`);
      router.refresh();
    } catch (error) {
      setStatus(undefined);
      alert(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={!!status}
        className="rounded-full bg-[#8b5e3c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#75492c] disabled:opacity-60"
      >
        {status ?? '+ Import PDF'}
      </button>
    </>
  );
}
