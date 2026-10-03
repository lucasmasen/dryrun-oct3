import { db, holdEscrow } from './server';
import type { CreateTaskInput } from './types';

export async function createTask(body: CreateTaskInput) {
  const live = body.response_type === 'live';
  // Live video tasks run for minutes, not seconds, and need exactly one human
  const ttl = body.ttl_seconds ?? (live ? 1800 : 180);
  const { data: task, error } = await db.from('tasks').insert({
    prompt: body.prompt,
    response_type: body.response_type ?? 'text',
    options: body.options ?? null,
    budget_cents: body.budget_cents ?? 500,
    min_responses: live ? 1 : body.min_responses ?? 3,
    closes_at: new Date(Date.now() + ttl * 1000).toISOString(),
  }).select().single();
  if (error) throw error;

  try {
    const pi = await holdEscrow(task.budget_cents, task.id);
    await db.from('tasks').update({ payment_intent_id: pi }).eq('id', task.id);
    task.payment_intent_id = pi;
  } catch (e) {
    console.error('escrow hold failed', e); // never block the loop on Stripe
  }
  return task;
}
