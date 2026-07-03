-- inkread library schema: user-owned books, chapter content, annotations,
-- and reading positions. All tables are RLS-gated per user; the app talks
-- to these through the API's repository layer, never directly.

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Books: library metadata (content lives in book_content).
create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  author text,
  language text not null default 'en',
  source text not null default 'pdf' check (source in ('pdf', 'epub')),
  chapter_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index books_user_idx on public.books (user_id, created_at desc);

alter table public.books enable row level security;

create policy "Users can read own books"
  on public.books for select using (auth.uid() = user_id);
create policy "Users can insert own books"
  on public.books for insert with check (auth.uid() = user_id);
create policy "Users can update own books"
  on public.books for update using (auth.uid() = user_id);
create policy "Users can delete own books"
  on public.books for delete using (auth.uid() = user_id);

create trigger books_updated_at
  before update on public.books
  for each row execute function public.handle_updated_at();

-- Book content: chapters as JSON, one row per book, separated from
-- metadata so library listings never drag megabytes of text along.
create table public.book_content (
  book_id uuid primary key references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapters jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.book_content enable row level security;

create policy "Users can read own book content"
  on public.book_content for select using (auth.uid() = user_id);
create policy "Users can insert own book content"
  on public.book_content for insert with check (auth.uid() = user_id);
create policy "Users can update own book content"
  on public.book_content for update using (auth.uid() = user_id);
create policy "Users can delete own book content"
  on public.book_content for delete using (auth.uid() = user_id);

create trigger book_content_updated_at
  before update on public.book_content
  for each row execute function public.handle_updated_at();

-- Annotations: highlights and notes anchored by chapter character offsets.
create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  kind text not null default 'highlight' check (kind in ('highlight', 'note')),
  chapter_index integer not null,
  start_offset integer not null,
  end_offset integer not null,
  passage text not null,
  note text,
  color text not null default 'yellow'
    check (color in ('yellow', 'green', 'blue', 'pink', 'purple')),
  chapter_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annotations_range check (end_offset > start_offset)
);

create index annotations_book_idx
  on public.annotations (book_id, chapter_index, start_offset);

alter table public.annotations enable row level security;

create policy "Users can read own annotations"
  on public.annotations for select using (auth.uid() = user_id);
create policy "Users can insert own annotations"
  on public.annotations for insert with check (auth.uid() = user_id);
create policy "Users can update own annotations"
  on public.annotations for update using (auth.uid() = user_id);
create policy "Users can delete own annotations"
  on public.annotations for delete using (auth.uid() = user_id);

create trigger annotations_updated_at
  before update on public.annotations
  for each row execute function public.handle_updated_at();

-- Reading positions: one per user per book.
create table public.reading_positions (
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_index integer not null default 0,
  char_offset integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (book_id, user_id)
);

alter table public.reading_positions enable row level security;

create policy "Users can read own positions"
  on public.reading_positions for select using (auth.uid() = user_id);
create policy "Users can insert own positions"
  on public.reading_positions for insert with check (auth.uid() = user_id);
create policy "Users can update own positions"
  on public.reading_positions for update using (auth.uid() = user_id);
create policy "Users can delete own positions"
  on public.reading_positions for delete using (auth.uid() = user_id);

create trigger reading_positions_updated_at
  before update on public.reading_positions
  for each row execute function public.handle_updated_at();
