-- Public serials + comment voting: the ingredients for a public discovery site.
--
-- Two moves here:
--   1. Books gain a publication model — `visibility` (private/public) and
--      `status` (ongoing/completed) — so an author can "publish" a work and
--      have it surface on the public home as an actively-published series.
--   2. Comments gain upvote/downvote via a `comment_votes` table, with the net
--      score denormalized onto `comments` (trigger-maintained) so anonymous
--      readers can sort a public discussion by score without touching votes.
--
-- Public-read RLS is added to books/chapters/comments for PUBLIC books only, so
-- the anon key can render the discovery pages while private libraries stay shut.

-- 1. Publication model on books ------------------------------------------------

alter table public.books
  add column visibility text not null default 'private'
    check (visibility in ('private', 'public')),
  add column status text not null default 'ongoing'
    check (status in ('ongoing', 'completed'));

-- Discovery feed: public + ongoing, most-recently-updated first.
create index books_public_idx
  on public.books (visibility, status, updated_at desc);

-- Anyone (incl. the anon role) may read a book row once it is public. This is
-- additive to the owner-only policy — Postgres ORs permissive policies.
create policy "Public books are readable by anyone"
  on public.books for select
  using (visibility = 'public');

-- Chapters of a public book are readable by anyone (so the work can be read /
-- its chapter list shown without a session).
create policy "Public book chapters are readable by anyone"
  on public.chapters for select
  using (
    exists (select 1 from public.books b where b.id = chapters.book_id and b.visibility = 'public')
  );

-- Comments on a public book are readable by anyone (the social layer, public).
create policy "Public book comments are readable by anyone"
  on public.comments for select
  using (
    exists (select 1 from public.books b where b.id = comments.book_id and b.visibility = 'public')
  );

-- 2. Comment voting ------------------------------------------------------------

-- Denormalized tallies so public reads sort by score with no votes join.
-- `score` is generated from the two counters and is what the UI orders on.
alter table public.comments
  add column up_count integer not null default 0,
  add column down_count integer not null default 0,
  add column score integer generated always as (up_count - down_count) stored;

create index comments_book_score_idx
  on public.comments (book_id, score desc, created_at desc);

-- One vote per (comment, user); value is +1 or -1. Changing your mind updates
-- the row; clearing your vote deletes it.
create table public.comment_votes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_votes enable row level security;

-- A voter can see and manage only their own votes (used to light up which way
-- they voted). The public tallies live on `comments`, so no cross-user read of
-- votes is needed.
create policy "Users can read own votes"
  on public.comment_votes for select
  using (auth.uid() = user_id);

-- Insert/update only as yourself, and only on a comment you can actually see
-- (a public book's, or your own book's) — no voting on hidden content.
create policy "Users can cast own votes"
  on public.comment_votes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.comments c
      join public.books b on b.id = c.book_id
      where c.id = comment_id and (b.visibility = 'public' or b.user_id = auth.uid())
    )
  );

create policy "Users can change own votes"
  on public.comment_votes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can clear own votes"
  on public.comment_votes for delete
  using (auth.uid() = user_id);

-- Keep the denormalized tallies on `comments` in step with the vote rows.
-- SECURITY DEFINER so the counter update isn't blocked by comments' RLS (a
-- voter is usually not the comment's author and can't otherwise update it).
create or replace function public.apply_comment_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.comments set
      up_count   = up_count   + (case when new.value = 1  then 1 else 0 end),
      down_count = down_count + (case when new.value = -1 then 1 else 0 end)
    where id = new.comment_id;
  elsif (tg_op = 'DELETE') then
    update public.comments set
      up_count   = up_count   - (case when old.value = 1  then 1 else 0 end),
      down_count = down_count - (case when old.value = -1 then 1 else 0 end)
    where id = old.comment_id;
  elsif (tg_op = 'UPDATE') then
    update public.comments set
      up_count   = up_count   + (case when new.value = 1  then 1 else 0 end)
                              - (case when old.value = 1  then 1 else 0 end),
      down_count = down_count + (case when new.value = -1 then 1 else 0 end)
                              - (case when old.value = -1 then 1 else 0 end)
    where id = new.comment_id;
  end if;
  return null;
end;
$$;

create trigger comment_votes_apply
  after insert or update or delete on public.comment_votes
  for each row execute function public.apply_comment_vote();
