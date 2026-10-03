import { db, releaseEscrow, refundEscrow } from './server';
import { aggregate, mechanicalScreen } from './screen';
import type { Task, TaskResponse, TaskResult } from './types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** aggregate → pay → store result. Idempotent, worst case ~6s. */
export async function closeTask(taskId: string): Promise<{ task: Task; result: TaskResult } | null> {
  // Atomic claim so a double call can't double-capture
  const { data: claimed } = await db
    .from('tasks').update({ status: 'closing' })
    .eq('id', taskId).eq('status', 'open').select().maybeSingle();

  if (!claimed) {
    // Already closed, or another call is closing it right now: wait for its result (max ~8s)
    for (let i = 0; i < 16; i++) {
      const { data: t } = await db.from('tasks').select('*').eq('id', taskId).maybeSingle();
      if (!t) return null;
      if (t.status === 'closed' && t.result) return { task: t as Task, result: t.result as TaskResult };
      await sleep(500);
    }
    return null;
  }
  const task = claimed as Task;
  if (task.response_type === 'live') return closeLive(task);

  const { data: rows } = await db.from('responses').select('*').eq('task_id', taskId).order('created_at');
  const all = (rows ?? []) as TaskResponse[];

  // Responses still mid-screen: decide them mechanically now instead of waiting on the AI
  const pending = all.filter(r => r.status === 'pending');
  for (const r of pending) {
    const v = mechanicalScreen(task, r.content) ?? { ok: true, reason: 'accepted at close' };
    r.status = v.ok ? 'accepted' : 'rejected';
    r.screen_reason = v.reason;
    await db.from('responses').update({ status: r.status, screen_reason: v.reason }).eq('id', r.id);
  }

  const accepted = all.filter(r => r.status === 'accepted');
  const { summary, winner, tally } = await aggregate(task, accepted.map(r => r.photo_url ? `${r.content} [photo proof attached, AI-verified: ${r.screen_reason ?? 'ok'}]` : r.content));

  const each = accepted.length ? Math.floor(task.budget_cents / accepted.length) : 0;
  const total = each * accepted.length;
  try {
    if (task.payment_intent_id) {
      if (total > 0) await releaseEscrow(task.payment_intent_id, total);
      else await refundEscrow(task.payment_intent_id);
    }
  } catch (e) {
    console.error('stripe release failed', e); // don't break the loop for the demo
  }
  if (accepted.length) {
    await db.from('responses').update({ payout_cents: each }).in('id', accepted.map(r => r.id));
  }

  const result: TaskResult = {
    summary,
    winner,
    tally,
    responses: accepted.map(r => ({ answer: r.content, name: r.worker_name, ...(r.photo_url ? { photo_verified: r.screen_reason ?? true } : {}) })),
    rejected: all.filter(r => r.status === 'rejected').length,
    paid: { total_cents: total, per_human_cents: each, stripe: task.payment_intent_id },
  };
  const { data: done } = await db.from('tasks').update({ status: 'closed', result })
    .eq('id', taskId).select().single();
  return { task: done as Task, result };
}

const clock = (sec: number) => `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;

/** Live video: the one picked human gets the whole budget. Returns who streamed and for how long. */
async function closeLive(task: Task): Promise<{ task: Task; result: TaskResult }> {
  const { data: rows } = await db.from('responses').select('*').eq('task_id', task.id).order('created_at');
  // Only real volunteers (claims from /live), never stray answers from bots or the regular endpoint
  const all = ((rows ?? []) as TaskResponse[]).filter(r => r.content === 'Volunteered for live video');
  const picked = all.find(r => r.id === task.assigned_response_id) ?? null;
  const secs = task.live_started_at ? Math.max(0, Math.round((Date.now() - new Date(task.live_started_at).getTime()) / 1000)) : 0;
  const streamed = Boolean(picked && task.live_started_at);
  const total = streamed ? task.budget_cents : 0;

  try {
    if (task.payment_intent_id) {
      if (total > 0) await releaseEscrow(task.payment_intent_id, total);
      else await refundEscrow(task.payment_intent_id);
    }
  } catch (e) {
    console.error('stripe release failed', e);
  }
  if (picked) {
    await db.from('responses').update({
      payout_cents: total,
      screen_reason: streamed ? `streamed live for ${clock(secs)}` : 'picked, never went live: not paid',
      status: streamed ? 'accepted' : 'rejected',
    }).eq('id', picked.id);
  }

  const result: TaskResult = {
    summary: streamed
      ? `${picked!.worker_name} completed the live video task: streamed for ${clock(secs)} (picked from ${all.length} volunteer${all.length === 1 ? '' : 's'}).`
      : picked
        ? `${picked.worker_name} was picked but never started streaming. Escrow refunded.`
        : 'No human volunteered for the live video task. Escrow refunded.',
    winner: streamed ? picked!.worker_name : '',
    responses: streamed ? [{ answer: `Streamed live for ${clock(secs)}`, name: picked!.worker_name }] : [],
    rejected: all.filter(r => r.id !== picked?.id).length,
    paid: { total_cents: total, per_human_cents: total, stripe: task.payment_intent_id },
  };
  const { data: done } = await db.from('tasks').update({ status: 'closed', result })
    .eq('id', task.id).select().single();
  return { task: done as Task, result };
}
