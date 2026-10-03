-- Run in Supabase SQL Editor as the project owner before deploying action routes.
-- Requires Supabase Storage's storage.buckets and the service_role database role.
-- Anonymous action access is API-only: no table/storage public policies or realtime.
create extension if not exists pgcrypto;

create table if not exists public.action_tasks (
  id                       uuid primary key default gen_random_uuid(),
  prompt                   text not null check (char_length(prompt) between 3 and 4000),
  proof_type               text not null check (proof_type in ('text', 'photo')),
  proof_instructions       text not null check (char_length(proof_instructions) between 3 and 4000),
  purchase_allowance_cents  integer not null check (purchase_allowance_cents between 0 and 100000),
  worker_reward_cents      integer not null check (worker_reward_cents between 0 and 100000),
  total_cents              integer not null check (total_cents = purchase_allowance_cents + worker_reward_cents),
  status                   text not null check (status in ('awaiting_funding', 'open', 'claimed', 'verifying', 'completed')),
  device_id_hash           text check (device_id_hash ~ '^[0-9a-f]{64}$'),
  claim_token_hash         text check (claim_token_hash ~ '^[0-9a-f]{64}$'),
  proof_photo_path         text check (proof_photo_path like id::text || '/%'),
  proof_text               text check (char_length(proof_text) between 3 and 4000),
  proof_status             text check (proof_status in ('pending', 'accepted', 'rejected')),
  proof_reason             text,
  checkout_session_id      text,
  checkout_url             text,
  payment_intent_id        text,
  funding_status           text not null default 'unfunded' check (funding_status in ('unfunded', 'held', 'captured')),
  result                   jsonb,
  created_at               timestamptz not null default now(),
  check (total_cents = 0 or total_cents between 50 and 100000),
  check ((status in ('awaiting_funding', 'open') and device_id_hash is null and claim_token_hash is null)
      or (status in ('claimed', 'verifying', 'completed') and device_id_hash is not null and claim_token_hash is not null)),
  check (status <> 'awaiting_funding' or (total_cents > 0 and funding_status = 'unfunded')),
  check (status not in ('open', 'claimed', 'verifying') or total_cents = 0 or funding_status in ('held', 'captured')),
  check (status <> 'verifying' or (proof_status is not null and proof_status in ('pending', 'accepted'))),
  check (status <> 'completed' or (proof_status is not null and proof_status = 'accepted' and result is not null
      and (total_cents = 0 or funding_status = 'captured'))),
  check (proof_status is null or
      (proof_type = 'text' and proof_text is not null and proof_photo_path is null) or
      (proof_type = 'photo' and proof_photo_path is not null and proof_text is null))
);

create index if not exists action_tasks_created_idx on public.action_tasks (created_at desc);
alter table public.action_tasks enable row level security;
revoke all on public.action_tasks from anon, authenticated;
grant select, insert, update, delete on public.action_tasks to service_role;

-- Signed read URLs and all uploads are produced by server service-role code.
-- This deliberately creates no storage.objects policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('action-proofs', 'action-proofs', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
