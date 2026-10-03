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
  const { summary, winner, tally } = await aggregate(task, accepted.map(r => r.content));

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
    responses: accepted.map(r => ({ answer: r.content, name: r.worker_name })),
    rejected: all.filter(r => r.status === 'rejected').length,
    paid: { total_cents: total, per_human_cents: each, stripe: task.payment_intent_id },
  };
  const { data: done } = await db.from('tasks').update({ status: 'closed', result })
    .eq('id', taskId).select().single();
  return { task: done as Task, result };
}
