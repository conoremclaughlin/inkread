-- Coins + per-chapter entitlements: the paid-serialization economy.
--
-- The shape:
--   * profiles  — one row per user, created on signup; holds a username and the
--     coin wallet (balance). Fills the "no profiles/usernames" gap in one move.
--   * coin_ledger — append-only record of every coin movement (grant, top-up,
--     spend, author earning), each row carrying the balance it left behind.
--   * chapter_unlocks — permanent per-user entitlement to a chapter. It grants
--     the chapter in ANY rendition (text now; its TTS / voice-cast audio reuses
--     the same gate later) so a purchase buys the whole multimedia experience.
--   * books gain a pricing policy: a free head of N chapters, then a flat
--     per-chapter price. coins_per_chapter = 0 means the whole book is free, so
--     every book that exists today stays free.
--
-- All spending goes through SECURITY DEFINER RPCs that check the balance, record
-- the unlock, debit the reader and credit the author atomically — the client can
-- never mint coins or grant itself an unlock. The single entitlement rule lives
-- in chapter_is_entitled(); a membership grant will add exactly one OR there.
--
-- Money is demo-funded to start (signup grant + grant_demo_coins top-up); a real
-- payment provider can later credit the same wallet without touching this schema.

-- 1. Profiles + wallet ---------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  coin_balance integer not null default 100 check (coin_balance >= 0),
  is_author boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user reads and edits only their own profile (the balance is private). Public
-- author display names get their own read path (a view) in a later migration.
create policy "Users can read own profile"
  on public.profiles for select using (auth.uid() = user_id);

-- Self-service edits are limited to display fields; the balance moves only via
-- the SECURITY DEFINER RPCs below (a WITH CHECK can't guard a specific column,
-- so a dedicated trigger pins coin_balance against direct client updates).
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.guard_profile_balance()
returns trigger language plpgsql as $$
begin
  -- A direct client UPDATE runs as the invoker; the RPCs run as SECURITY DEFINER
  -- (role postgres/service). Only privileged callers may move the balance.
  if new.coin_balance is distinct from old.coin_balance
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'coin_balance is read-only; spend via the coin RPCs'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger profiles_guard_balance
  before update on public.profiles
  for each row execute function public.guard_profile_balance();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- New users get a wallet with a demo starting grant, recorded in the ledger.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name, coin_balance)
  values (new.id, split_part(new.email, '@', 1), 100)
  on conflict (user_id) do nothing;
  insert into public.coin_ledger (user_id, delta, reason, balance_after)
  values (new.id, 100, 'signup_grant', 100);
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Book pricing policy -------------------------------------------------------

alter table public.books
  add column free_chapter_count integer not null default 0
    check (free_chapter_count >= 0),
  add column coins_per_chapter integer not null default 0
    check (coins_per_chapter >= 0);

-- 3. Coin ledger ---------------------------------------------------------------

create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in
    ('signup_grant', 'topup', 'unlock_spend', 'author_earning', 'refund', 'adjustment')),
  book_id uuid references public.books(id) on delete set null,
  chapter_index integer,
  balance_after integer not null,
  created_at timestamptz not null default now()
);

create index coin_ledger_user_idx on public.coin_ledger (user_id, created_at desc);

alter table public.coin_ledger enable row level security;

-- Users read their own statement; no client writes (entries come from the RPCs).
create policy "Users can read own ledger"
  on public.coin_ledger for select using (auth.uid() = user_id);

-- 4. Chapter unlocks (entitlements) --------------------------------------------

create table public.chapter_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  chapter_index integer not null,
  coins_spent integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id, chapter_index)
);

create index chapter_unlocks_user_book_idx
  on public.chapter_unlocks (user_id, book_id);

alter table public.chapter_unlocks enable row level security;

-- Users see their own entitlements (to light up owned chapters); unlocks are
-- written only by the purchase RPCs, never directly by a client.
create policy "Users can read own unlocks"
  on public.chapter_unlocks for select using (auth.uid() = user_id);

-- 5. The entitlement gate ------------------------------------------------------

-- The ONE definition of "may this user read this chapter". Text reads use it now;
-- audio playback will reuse it. Membership adds one more OR here — nowhere else.
create or replace function public.chapter_is_entitled(
  p_user uuid, p_book_id uuid, p_chapter_index integer
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.books b
    where b.id = p_book_id
      and (
        b.coins_per_chapter = 0                       -- whole book free
        or p_chapter_index < b.free_chapter_count      -- within the free head
        or (p_user is not null and p_user = b.user_id) -- the author
        or (p_user is not null and exists (            -- a recorded unlock
          select 1 from public.chapter_unlocks u
          where u.user_id = p_user
            and u.book_id = p_book_id
            and u.chapter_index = p_chapter_index
        ))
      )
  );
$$;

-- 6. Entitled read -------------------------------------------------------------

-- The gated read path for public reading. Returns a chapter's body ONLY when the
-- caller is entitled; otherwise `locked` with the coin cost so the client can
-- render a paywall. auth.uid() is null for anonymous visitors (free head only).
create or replace function public.read_public_chapter(
  p_book_id uuid, p_chapter_index integer
) returns table (chapter_index integer, title text, paragraphs jsonb, locked boolean, coin_cost integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_book public.books%rowtype;
  v_entitled boolean;
  v_free boolean;
begin
  select * into v_book from public.books where id = p_book_id and visibility = 'public';
  if not found then return; end if;  -- not public / missing → no rows (route 404s)

  v_free := (v_book.coins_per_chapter = 0 or p_chapter_index < v_book.free_chapter_count);
  v_entitled := public.chapter_is_entitled(v_user, p_book_id, p_chapter_index);

  return query
    select c.chapter_index,
           c.title,
           case when v_entitled then c.paragraphs else null end,
           not v_entitled,
           case when v_free then 0 else v_book.coins_per_chapter end
    from public.chapters c
    where c.book_id = p_book_id and c.chapter_index = p_chapter_index;
end; $$;

-- 6b. Harden public chapter reads ----------------------------------------------

-- The public-serials migration exposed EVERY column of a public book's chapters
-- (bodies included) to the anon role. Now that chapters can be paid, that would
-- leak locked bodies straight from the table. Narrow the public read to the free
-- head only; paid bodies flow solely through read_public_chapter (entitled).
drop policy if exists "Public book chapters are readable by anyone" on public.chapters;

create policy "Public free chapters are readable by anyone"
  on public.chapters for select
  using (
    exists (
      select 1 from public.books b
      where b.id = chapters.book_id
        and b.visibility = 'public'
        and (b.coins_per_chapter = 0 or chapters.chapter_index < b.free_chapter_count)
    )
  );

-- The full table of contents — index + title for EVERY chapter, free or paid —
-- of a public book. Titles aren't secret; only bodies are gated. Lets the series
-- page list locked chapters with a price without exposing their text.
create or replace function public.public_series_toc(p_book_id uuid)
returns table (chapter_index integer, title text)
language sql stable security definer set search_path = public as $$
  select c.chapter_index, c.title
  from public.chapters c
  join public.books b on b.id = c.book_id
  where c.book_id = p_book_id and b.visibility = 'public'
  order by c.chapter_index;
$$;

-- 7. Purchase RPCs -------------------------------------------------------------

-- Demo revenue share: the author is credited the full price a reader spends.
-- Internal — revoked from clients so no one can credit an author at will.
create or replace function public.credit_author(
  p_author uuid, p_amount integer, p_book_id uuid, p_chapter_index integer
) returns void language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  if p_amount <= 0 or p_author is null then return; end if;
  update public.profiles set coin_balance = coin_balance + p_amount, updated_at = now()
    where user_id = p_author returning coin_balance into v_balance;
  if not found then return; end if;
  insert into public.coin_ledger (user_id, delta, reason, book_id, chapter_index, balance_after)
    values (p_author, p_amount, 'author_earning', p_book_id, p_chapter_index, v_balance);
end; $$;

-- Ensure a wallet row exists and return the balance, locked for update. Guards
-- against a user who predates the signup trigger.
create or replace function public.lock_wallet(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_balance integer;
begin
  select coin_balance into v_balance from public.profiles where user_id = p_user for update;
  if not found then
    insert into public.profiles (user_id) values (p_user) on conflict (user_id) do nothing;
    select coin_balance into v_balance from public.profiles where user_id = p_user for update;
  end if;
  return v_balance;
end; $$;

-- Everything a user has purchased for a book, ascending — the canonical "owned"
-- set the client can adopt wholesale after a purchase.
create or replace function public.owned_chapters(p_user uuid, p_book_id uuid)
returns integer[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(u.chapter_index order by u.chapter_index), '{}')
  from public.chapter_unlocks u
  where u.user_id = p_user and u.book_id = p_book_id;
$$;

-- Buy a single chapter. Idempotent: a free/owned/already-unlocked chapter costs
-- nothing. Raises 'insufficient coins' (P0001) when the wallet is short.
create or replace function public.unlock_chapter(p_book_id uuid, p_chapter_index integer)
returns table (unlocked integer[], coins_spent integer, balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_book public.books%rowtype;
  v_balance integer;
  v_spent integer := 0;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_book from public.books where id = p_book_id and visibility = 'public';
  if not found then raise exception 'series not found' using errcode = 'P0002'; end if;
  if p_chapter_index < 0 or p_chapter_index >= v_book.chapter_count then
    raise exception 'chapter out of range' using errcode = '22003';
  end if;

  v_balance := public.lock_wallet(v_user);

  if not (
    v_book.coins_per_chapter = 0
    or p_chapter_index < v_book.free_chapter_count
    or v_user = v_book.user_id
    or exists (select 1 from public.chapter_unlocks u
               where u.user_id = v_user and u.book_id = p_book_id
                 and u.chapter_index = p_chapter_index)
  ) then
    v_spent := v_book.coins_per_chapter;
    if v_balance < v_spent then
      raise exception 'insufficient coins: need % have %', v_spent, v_balance using errcode = 'P0001';
    end if;
    update public.profiles set coin_balance = coin_balance - v_spent, updated_at = now()
      where user_id = v_user returning coin_balance into v_balance;
    insert into public.chapter_unlocks (user_id, book_id, chapter_index, coins_spent)
      values (v_user, p_book_id, p_chapter_index, v_spent);
    insert into public.coin_ledger (user_id, delta, reason, book_id, chapter_index, balance_after)
      values (v_user, -v_spent, 'unlock_spend', p_book_id, p_chapter_index, v_balance);
    perform public.credit_author(v_book.user_id, v_spent, p_book_id, p_chapter_index);
  end if;

  return query select public.owned_chapters(v_user, p_book_id), v_spent, v_balance;
end; $$;

-- Buy every still-locked paid chapter of a book in one transaction (batch unlock
-- / "own the book"). Charges the sum of the remaining paid chapters.
create or replace function public.unlock_book(p_book_id uuid)
returns table (unlocked integer[], coins_spent integer, balance integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_book public.books%rowtype;
  v_balance integer;
  v_cost integer;
  v_pending integer[];
  v_total integer := 0;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_book from public.books where id = p_book_id and visibility = 'public';
  if not found then raise exception 'series not found' using errcode = 'P0002'; end if;

  v_balance := public.lock_wallet(v_user);
  v_cost := v_book.coins_per_chapter;

  if v_cost > 0 and v_user <> v_book.user_id then
    select coalesce(array_agg(gs order by gs), '{}') into v_pending
    from generate_series(v_book.free_chapter_count, v_book.chapter_count - 1) gs
    where not exists (
      select 1 from public.chapter_unlocks u
      where u.user_id = v_user and u.book_id = p_book_id and u.chapter_index = gs
    );

    if array_length(v_pending, 1) is not null then
      v_total := v_cost * array_length(v_pending, 1);
      if v_balance < v_total then
        raise exception 'insufficient coins: need % have %', v_total, v_balance using errcode = 'P0001';
      end if;
      update public.profiles set coin_balance = coin_balance - v_total, updated_at = now()
        where user_id = v_user returning coin_balance into v_balance;
      insert into public.chapter_unlocks (user_id, book_id, chapter_index, coins_spent)
        select v_user, p_book_id, gs, v_cost from unnest(v_pending) gs;
      insert into public.coin_ledger (user_id, delta, reason, book_id, balance_after)
        values (v_user, -v_total, 'unlock_spend', p_book_id, v_balance);
      perform public.credit_author(v_book.user_id, v_total, p_book_id, null);
    end if;
  end if;

  return query select public.owned_chapters(v_user, p_book_id), v_total, v_balance;
end; $$;

-- Demo top-up: mint coins into the caller's wallet, no real charge. A payment
-- provider will later call the same crediting path server-side.
create or replace function public.grant_demo_coins(p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_balance integer;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'invalid top-up amount' using errcode = '22003';
  end if;
  insert into public.profiles (user_id) values (v_user) on conflict (user_id) do nothing;
  update public.profiles set coin_balance = coin_balance + p_amount, updated_at = now()
    where user_id = v_user returning coin_balance into v_balance;
  insert into public.coin_ledger (user_id, delta, reason, balance_after)
    values (v_user, p_amount, 'topup', v_balance);
  return v_balance;
end; $$;

-- 8. Grants --------------------------------------------------------------------

-- Anonymous + signed-in visitors may read chapters through the entitled path
-- and list a public book's table of contents.
grant execute on function public.read_public_chapter(uuid, integer) to anon, authenticated;
grant execute on function public.chapter_is_entitled(uuid, uuid, integer) to anon, authenticated;
grant execute on function public.public_series_toc(uuid) to anon, authenticated;

-- Only signed-in users spend / top up.
grant execute on function public.unlock_chapter(uuid, integer) to authenticated;
grant execute on function public.unlock_book(uuid) to authenticated;
grant execute on function public.grant_demo_coins(integer) to authenticated;

-- Internal helpers — never callable by clients.
revoke execute on function public.credit_author(uuid, integer, uuid, integer) from public, anon, authenticated;
revoke execute on function public.lock_wallet(uuid) from public, anon, authenticated;
revoke execute on function public.owned_chapters(uuid, uuid) from public, anon, authenticated;

-- 9. Backfill existing users ---------------------------------------------------

insert into public.profiles (user_id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (user_id) do nothing;
