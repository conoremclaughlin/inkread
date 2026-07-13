-- Per-user app preferences. A single jsonb blob per user: reading settings
-- (theme, layout, font size, TTS rate/voice) change shape often, and the
-- repository merges partial updates, so columns would only slow us down.
create table public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reader jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.preferences enable row level security;

create policy "Users can read own preferences"
  on public.preferences for select using (auth.uid() = user_id);
create policy "Users can insert own preferences"
  on public.preferences for insert with check (auth.uid() = user_id);
create policy "Users can update own preferences"
  on public.preferences for update using (auth.uid() = user_id);
create policy "Users can delete own preferences"
  on public.preferences for delete using (auth.uid() = user_id);

create trigger preferences_updated_at
  before update on public.preferences
  for each row execute function public.handle_updated_at();
