-- Live video tasks (response_type = 'live'). Paste into Supabase SQL Editor and Run. Safe to re-run.
-- A volunteer = a row in responses. The picked volunteer = tasks.assigned_response_id.
-- Video goes phone -> viewer over WebRTC; Supabase Realtime broadcast carries the handshake.

alter table public.tasks drop constraint if exists tasks_response_type_check;
alter table public.tasks add constraint tasks_response_type_check
  check (response_type in ('text','choice','photo','live'));

alter table public.tasks add column if not exists assigned_response_id uuid references public.responses(id) on delete set null;
alter table public.tasks add column if not exists live_started_at timestamptz;

-- One volunteer/answer per device per task (the /do page already sends device_id)
alter table public.responses add column if not exists device_id text;
create unique index if not exists responses_task_device_uniq on public.responses (task_id, device_id);
