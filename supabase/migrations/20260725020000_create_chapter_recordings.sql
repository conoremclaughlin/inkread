-- Multi-voice chapter recordings: metadata for a rendered audio file (the bytes
-- live in the `recordings` storage bucket at storage_path). One current
-- recording per chapter; re-recording replaces it.

create table public.chapter_recordings (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  chapter_index integer not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  unique (book_id, chapter_index)
);

create index chapter_recordings_book_idx on public.chapter_recordings (book_id, chapter_index);

alter table public.chapter_recordings enable row level security;

-- Read: any authenticated reader (so listeners can play the recording).
create policy "Authenticated can read recordings"
  on public.chapter_recordings for select
  using (auth.role() = 'authenticated');

-- Write: only the owner of the book (the person who ran the render).
create policy "Book owners manage recordings"
  on public.chapter_recordings for all
  using (
    exists (select 1 from public.books b where b.id = book_id and b.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.books b where b.id = book_id and b.user_id = auth.uid())
  );
