import { db, json } from '@/lib/delegate/server';
import { createTask } from '@/lib/delegate/tasks';
import { toView } from '@/lib/delegate/view';
import type { Task } from '@/lib/delegate/types';

// 1. Create task (agent → backend). Escrow is held inside createTask.
export async function POST(req: Request) {
  try {
    const task = await createTask(await req.json());
    return json({ id: task.id, status: task.status, payment_intent_id: task.payment_intent_id }, 201);
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
}

// List with status + responses_count (test bots, phone page). ?status=open to filter.
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status');
  let q = db.from('tasks').select('*').order('created_at', { ascending: false }).limit(20);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return json(await toView((data ?? []) as Task[]));
}

export async function OPTIONS() {
  return new Response(null, { headers: cors });
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
