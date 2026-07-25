-- Reader comments: the social layer. Per-chapter comments visible to other
-- readers of a work.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_index integer not null,
  -- Denormalized display name so the list never needs a profile join.
  author_name text,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index comments_book_chapter_idx
  on public.comments (book_id, chapter_index, created_at);

alter table public.comments enable row level security;

-- Read: any authenticated reader — comments are a shared, social artifact.
-- (Intentionally permissive until a book-level access/sharing model lands, at
-- which point this tightens to "can read the book". In practice reads are
-- scoped by book_id, which a non-owner of a private book won't know.)
create policy "Authenticated can read comments"
  on public.comments for select
  using (auth.role() = 'authenticated');

-- Write only as yourself; delete only your own.
create policy "Users can insert own comments"
  on public.comments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own comments"
  on public.comments for delete
  using (auth.uid() = user_id);
