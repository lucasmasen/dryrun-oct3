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
