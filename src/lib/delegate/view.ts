import { db } from './server';
import type { Task, TaskView } from './types';

/** Shape for GET /api/tasks and GET /api/tasks/:id */
export async function toView(tasks: Task[]): Promise<TaskView[]> {
  if (!tasks.length) return [];
  const { data } = await db.from('responses').select('task_id').in('task_id', tasks.map(t => t.id));
  const counts: Record<string, number> = {};
  for (const r of data ?? []) counts[r.task_id] = (counts[r.task_id] ?? 0) + 1;

  return tasks.map(t => ({
    id: t.id,
    prompt: t.prompt,
    response_type: t.response_type,
    options: t.options,
    status: t.status,
    responses_count: counts[t.id] ?? 0,
    budget_cents: t.budget_cents,
    created_at: t.created_at,
    ...(t.status === 'closed' && t.result ? { result: t.result } : {}),
  }));
}
