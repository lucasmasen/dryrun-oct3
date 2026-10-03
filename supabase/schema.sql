-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--
-- Two tables. `profiles` tracks each user's plan; `items` is the generic table
-- your idea lives in. Rename it, add columns, whatever — just keep the user_id
-- column and the policies, because those are what make the app safe to expose.
--
-- Row Level Security is on for both and every policy keys on auth.uid(), so a
-- user can only reach their own rows even through the anon key in the browser.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  plan        text not null default 'free' check (plan in ('free', 'pro')),
  created_at  timestamptz not null default now()
);

-- RENAME ME. `input` is whatever the user typed, `output` is whatever the model
-- returned. jsonb on the output means you can change the shape of what you
-- generate without a migration — useful when you pivot at 2pm.
create table if not exists public.items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  input       text not null,
  output      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists items_user_created_idx
  on public.items (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.items    enable row level security;

drop policy if exists "read own profile"   on public.profiles;
drop policy if exists "update own profile" on public.profiles;
create policy "read own profile"   on public.profiles for select using (auth.uid() = id);
create policy "update own profile" on public.profiles for update using (auth.uid() = id);

-- with check on insert is what stops a client writing a row under someone
-- else's user_id. Don't drop it when you rename this table.
drop policy if exists "read own items"   on public.items;
drop policy if exists "insert own items" on public.items;
drop policy if exists "update own items" on public.items;
drop policy if exists "delete own items" on public.items;
create policy "read own items"   on public.items for select using (auth.uid() = user_id);
create policy "insert own items" on public.items for insert with check (auth.uid() = user_id);
create policy "update own items" on public.items for update using (auth.uid() = user_id);
create policy "delete own items" on public.items for delete using (auth.uid() = user_id);

-- Every new signup gets a profile row automatically, so the app never has to
-- handle a logged-in user with no plan.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===========================================================================
-- delegate_to_human: tasks + responses
-- Safe to re-run. All writes go through /api/tasks* with the service-role key.
--
-- Deliberate exception to the auth.uid() policy rule above: this flow has no
-- users (the agent, phones and bots are anonymous), and the live board reads
-- via realtime with the anon key. So these tables are PUBLIC READ-ONLY, with
-- no insert/update/delete policies, which means the anon key cannot write.
-- Don't put anything sensitive in them.
-- ===========================================================================

create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  prompt            text not null,
  response_type     text not null check (response_type in ('text','choice','photo')),
  options           jsonb,                      -- string[] for 'choice'
  budget_cents      int  not null default 500,
  min_responses     int  not null default 3,
  status            text not null default 'open' check (status in ('open','closing','closed')),
  payment_intent_id text,
  result            jsonb,
  closes_at         timestamptz not null default now() + interval '3 minutes',
  created_at        timestamptz not null default now()
);

create table if not exists public.responses (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  worker_name   text not null default 'anon',
  content       text not null,
  photo_url     text,
  status        text not null default 'pending' check (status in ('pending','accepted','rejected')),
  screen_reason text,
  payout_cents  int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists responses_task_idx on public.responses (task_id, created_at);

-- Realtime: the board subscribes to both tables
alter table public.tasks     replica identity full;
alter table public.responses replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'responses') then
    alter publication supabase_realtime add table public.responses;
  end if;
end $$;

alter table public.tasks     enable row level security;
alter table public.responses enable row level security;
drop policy if exists "public read tasks"     on public.tasks;
drop policy if exists "public read responses" on public.responses;
create policy "public read tasks"     on public.tasks     for select using (true);
create policy "public read responses" on public.responses for select using (true);
