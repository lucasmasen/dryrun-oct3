import { json } from '@/lib/delegate/server';
import { closeTask } from '@/lib/delegate/close';

export const maxDuration = 15;

// 4. Close: aggregate → pay → return data. Screening already happened at submit, so this is fast.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const out = await closeTask(id);
  if (!out) return json({ error: 'task not found or close timed out' }, 404);
  return json({ id: out.task.id, status: 'closed', result: out.result });
}
