import { db, json } from '@/lib/delegate/server';
import type { LiveView, Task, TaskResult } from '@/lib/delegate/types';

/**
 * Live video tasks (response_type = 'live').
 *
 *   GET  /api/tasks/:id/live                         -> LiveView (also runs auto-select when the window is up)
 *   POST /api/tasks/:id/live { action: 'claim', name, device_id }   volunteer for the task
 *   POST /api/tasks/:id/live { action: 'assign' }                   pick a volunteer now
 *   POST /api/tasks/:id/live { action: 'started', claim_id }        picked phone reports camera is live
 *
 * Ending + paying is the normal POST /api/tasks/:id/close (see closeLive in lib/delegate/close.ts).
 */
export const dynamic = 'force-dynamic';

const WINDOW_S = Number(process.env.LIVE_CLAIM_WINDOW_SECONDS || 15);
const NOT_PICKED = 'standby: another volunteer was picked';
const CLAIM = 'Volunteered for live video'; // must match closeLive in lib/delegate/close.ts

type Claim = { id: string; worker_name: string; status: string; created_at: string };

async function load(id: string) {
  const { data: task } = await db.from('tasks').select('*').eq('id', id).maybeSingle();
  if (!task) return null;
  const { data } = await db.from('responses')
    .select('id, worker_name, status, created_at').eq('task_id', id).eq('content', CLAIM).order('created_at');
  return { task: task as Task, claims: (data ?? []) as Claim[] };
}

/** Pick one volunteer at random. Atomic: only the first caller wins. */
async function assign(id: string, claims: Claim[]) {
  const pool = claims.filter(c => c.status === 'accepted');
  if (!pool.length) return false;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const { data: won } = await db.from('tasks').update({ assigned_response_id: pick.id })
    .eq('id', id).eq('status', 'open').is('assigned_response_id', null).select('id').maybeSingle();
  if (!won) return false;
  const others = pool.filter(c => c.id !== pick.id).map(c => c.id);
  if (others.length) {
    await db.from('responses').update({ status: 'rejected', screen_reason: NOT_PICKED }).in('id', others);
  }
  await db.from('responses').update({ screen_reason: 'picked: streaming live' }).eq('id', pick.id);
  return true;
}

function view(task: Task, claims: Claim[]): LiveView {
  const first = claims[0];
  const picked = claims.find(c => c.id === task.assigned_response_id);
  return {
    id: task.id,
    prompt: task.prompt,
    status: task.status,
    budget_cents: task.budget_cents,
    claims: claims.map(c => ({ id: c.id, name: c.worker_name, created_at: c.created_at })),
    claim_window_seconds: WINDOW_S,
    selects_at: first && !task.assigned_response_id
      ? new Date(new Date(first.created_at).getTime() + WINDOW_S * 1000).toISOString()
      : null,
    assigned: picked ? { claim_id: picked.id, name: picked.worker_name } : null,
    live_started_at: task.live_started_at ?? null,
    result: (task.result as TaskResult) ?? null,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let s = await load(id);
  if (!s) return json({ error: 'task not found' }, 404);
  if (s.task.response_type !== 'live') return json({ error: 'not a live task' }, 400);

  // Auto-select: once the claim window after the first volunteer has passed
  const first = s.claims[0];
  if (s.task.status === 'open' && !s.task.assigned_response_id && first
      && Date.now() - new Date(first.created_at).getTime() >= WINDOW_S * 1000) {
    if (await assign(id, s.claims)) s = (await load(id))!;
  }
  return json(view(s.task, s.claims));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const s = await load(id);
  if (!s) return json({ ok: false, error: 'task not found' }, 404);
  if (s.task.response_type !== 'live') return json({ ok: false, error: 'not a live task' }, 400);

  switch (body.action) {
    case 'claim': {
      if (s.task.status !== 'open') return json({ ok: false, error: 'task closed' }, 409);
      const deviceId = body.device_id ? String(body.device_id).slice(0, 64) : null;
      const { data: row, error } = await db.from('responses').insert({
        task_id: id,
        worker_name: String(body.name ?? '').trim().slice(0, 40) || 'anon',
        content: CLAIM,
        status: s.task.assigned_response_id ? 'rejected' : 'accepted',
        screen_reason: s.task.assigned_response_id ? NOT_PICKED : 'volunteer',
        ...(deviceId ? { device_id: deviceId } : {}),
      }).select('id').single();
      if (error?.code === '23505' && deviceId) {
        // Same phone again (e.g. page refresh): return its existing claim
        const { data: mine } = await db.from('responses').select('id')
          .eq('task_id', id).eq('device_id', deviceId).maybeSingle();
        if (mine) return json({ ok: true, claim_id: mine.id, again: true });
      }
      if (error) return json({ ok: false, error: error.message }, 400);
      if (s.task.assigned_response_id) return json({ ok: false, claim_id: row.id, error: 'Someone was already picked for this one' }, 409);
      return json({ ok: true, claim_id: row.id }, 201);
    }
    case 'assign': {
      if (s.task.status !== 'open') return json({ ok: false, error: 'task closed' }, 409);
      if (!s.task.assigned_response_id) await assign(id, s.claims);
      const after = (await load(id))!;
      return json(view(after.task, after.claims));
    }
    case 'started': {
      if (body.claim_id && body.claim_id === s.task.assigned_response_id && !s.task.live_started_at) {
        await db.from('tasks').update({ live_started_at: new Date().toISOString() }).eq('id', id);
      }
      return json({ ok: true });
    }
    default:
      return json({ ok: false, error: "action must be 'claim', 'assign' or 'started'" }, 400);
  }
}
