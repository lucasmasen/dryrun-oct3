import { db, json } from '@/lib/delegate/server';
import { screenResponse } from '@/lib/delegate/screen';
import type { Task } from '@/lib/delegate/types';

// 3. Submit response (phone page → backend). Body: { answer, name }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const answer: string = (body.answer ?? body.content ?? '').toString().trim();
  const name: string = (body.name ?? body.worker_name ?? '').toString().trim();
  const deviceId: string | null = body.device_id ? String(body.device_id).slice(0, 64) : null;
  if (!answer) return json({ ok: false, error: 'answer required' }, 400);

  const { data: task } = await db.from('tasks').select('*').eq('id', id).maybeSingle();
  if (!task) return json({ ok: false, error: 'task not found' }, 404);
  if (task.status !== 'open') return json({ ok: false, error: 'task closed' }, 409);

  // Normalize choice answers to the exact option string
  const content = task.response_type === 'choice'
    ? (task.options ?? []).find((o: string) => o.toLowerCase() === answer.toLowerCase()) ?? answer
    : answer.slice(0, 1000);

  // Insert as pending first so the board shows it instantly, then screen
  const { data: row, error } = await db.from('responses').insert({
    task_id: id,
    worker_name: name.slice(0, 40) || 'anon',
    content,
    photo_url: body.photo_url ?? null,
    ...(deviceId ? { device_id: deviceId } : {}),
  }).select().single();
  // One answer per device per task (unique index on task_id, device_id)
  if (error?.code === '23505') return json({ ok: false, error: 'You already answered this task' }, 409);
  if (error) return json({ ok: false, error: error.message }, 400);

  const verdict = await screenResponse(task as Task, content);
  // Only update if close hasn't already decided it
  await db.from('responses').update({
    status: verdict.ok ? 'accepted' : 'rejected',
    screen_reason: verdict.reason,
  }).eq('id', row.id).eq('status', 'pending');

  return json({ ok: true, id: row.id, accepted: verdict.ok, reason: verdict.reason }, 201);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await db.from('responses').select('*').eq('task_id', id).order('created_at');
  return json((data ?? []).map(r => ({ answer: r.content, name: r.worker_name, status: r.status, reason: r.screen_reason, created_at: r.created_at })));
}
