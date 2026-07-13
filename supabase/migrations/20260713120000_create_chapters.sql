-- Per-chapter content rows, replacing the single book_content jsonb blob.
-- Serialized works append chapters as single-row inserts, clients can sync
-- deltas by updated_at, and the reader can fetch chapters individually.

create table public.chapters (
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_index integer not null,
  title text not null,
  paragraphs jsonb not null default '[]'::jsonb,
  source_pages jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (book_id, chapter_index)
);

create index chapters_delta_idx on public.chapters (book_id, updated_at);

alter table public.chapters enable row level security;

create policy "Users can read own chapters"
  on public.chapters for select using (auth.uid() = user_id);
create policy "Users can insert own chapters"
  on public.chapters for insert with check (auth.uid() = user_id);
create policy "Users can update own chapters"
  on public.chapters for update using (auth.uid() = user_id);
create policy "Users can delete own chapters"
  on public.chapters for delete using (auth.uid() = user_id);

create trigger chapters_updated_at
  before update on public.chapters
  for each row execute function public.handle_updated_at();

-- Backfill from the jsonb blobs, then retire book_content.
insert into public.chapters (book_id, user_id, chapter_index, title, paragraphs, source_pages)
select
  content.book_id,
  content.user_id,
  (element.ord - 1)::integer,
  coalesce(element.value->>'title', 'Chapter ' || element.ord),
  coalesce(element.value->'paragraphs', '[]'::jsonb),
  element.value->'sourcePages'
from public.book_content content,
  lateral jsonb_array_elements(content.chapters)
    with ordinality as element(value, ord);

drop table public.book_content;
