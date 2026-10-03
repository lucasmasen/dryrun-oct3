import { db, json } from '@/lib/delegate/server';
import { toView } from '@/lib/delegate/view';
import type { Task } from '@/lib/delegate/types';

// 2. Get task (agent polls every 1.5s). Includes result once closed.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await db.from('tasks').select('*').eq('id', id).maybeSingle();
  if (!data) return json({ error: 'task not found' }, 404);
  const [view] = await toView([data as Task]);
  return json(view);
}
