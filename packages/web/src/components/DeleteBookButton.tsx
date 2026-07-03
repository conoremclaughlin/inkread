'use client';

import { useRouter } from 'next/navigation';

export function DeleteBookButton({ bookId, title }: { bookId: string; title: string }) {
  const router = useRouter();
  return (
    <button
      className="text-[#6b6459] opacity-0 transition group-hover:opacity-100 hover:text-[#b3402a]"
      onClick={async () => {
        if (!confirm(`Remove “${title}” and all its notes?`)) return;
        await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
        router.refresh();
      }}
    >
      Delete
    </button>
  );
}
