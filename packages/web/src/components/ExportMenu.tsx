'use client';

import { useState } from 'react';

const FORMATS = [
  { label: 'Markdown', hint: 'Paste into Notion or a doc', format: 'markdown' },
  { label: 'CSV', hint: 'Import as a Notion database or Sheets', format: 'csv' },
];

/** "Export ▾" action menu on the Notes page: pick a format, download it. */
export function ExportMenu({ bookId }: { bookId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="whitespace-nowrap rounded-full bg-[#8b5e3c] px-4 py-2 font-semibold text-white transition hover:bg-[#75492c]"
      >
        Export ▾
      </button>
      {open ? (
        <>
          <button
            aria-label="Close export menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-[#e6dfd4] bg-white text-left shadow-lg">
            {FORMATS.map((f) => (
              <a
                key={f.format}
                href={`/api/books/${bookId}/export?format=${f.format}`}
                onClick={() => setOpen(false)}
                className="block px-4 py-3 hover:bg-[#f0e6da]"
              >
                <span className="block font-semibold text-[#26221c]">{f.label}</span>
                <span className="block text-xs text-[#6b6459]">{f.hint}</span>
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
