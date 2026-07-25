-- Multi-voice casting: one cast per book (speakers → voices, plus the rules
-- that attribute lines to speakers). Built in the web editor; read by anyone
-- who can play the chapter's multi-voice audio.

create table public.voice_casts (
  book_id uuid primary key references public.books(id) on delete cascade,
  updated_by uuid not null references auth.users(id) on delete cascade,
  speakers jsonb not null default '[]'::jsonb,
  rules jsonb not null default '[]'::jsonb,
  default_speaker_id text,
  updated_at timestamptz not null default now()
);

alter table public.voice_casts enable row level security;

-- Read: any authenticated reader (so listeners can render the multi-voice audio).
create policy "Authenticated can read voice casts"
  on public.voice_casts for select
  using (auth.role() = 'authenticated');

-- Write: only the owner of the book the cast belongs to.
create policy "Book owners manage the voice cast"
  on public.voice_casts for all
  using (
    exists (select 1 from public.books b where b.id = book_id and b.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.books b where b.id = book_id and b.user_id = auth.uid())
  );
