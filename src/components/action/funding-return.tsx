'use client';

import { useEffect, useState } from 'react';
import { ActionTaskIdSchema, ActionTaskViewSchema, type ActionTaskView } from '@/lib/action/types';

export default function FundingReturn({ id, canceled }: { id: string; canceled: boolean }) {
  const [task, setTask] = useState<ActionTaskView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let reading = false;
    let confirmed = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (reading || confirmed) return;
      if (!ActionTaskIdSchema.safeParse(id).success) { setError('Action task ID is invalid.'); return; }
      reading = true;
      try {
        const response = await fetch(`/api/action-tasks/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : response.status === 404 ? 'Action task not found.' : 'Funding verification unavailable. No funding confirmation yet.');
        const next = ActionTaskViewSchema.parse(body);
        if (next.id !== id) throw new Error('Invalid task response.');
        if (!active) return;
        setTask(next);
        setError(null);
        confirmed = next.funding?.status === 'captured' || next.total_cents === 0;
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Funding verification unavailable. Retrying…');
      } finally { reading = false; }
    };
    void refresh();
    const interval = window.setInterval(refresh, 1500);
    return () => { active = false; controller.abort(); window.clearInterval(interval); };
  }, [id, retry]);

  const funding = task?.funding?.status;
  return (
    <main className="mx-auto min-h-svh max-w-lg space-y-6 bg-black px-5 py-10 text-white [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-4 [&_a]:focus-visible:outline-white [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-white">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-400">Stripe TEST funding</p>
        <h1 className="text-3xl font-semibold tracking-tight">Action funding</h1>
        <p className="text-sm text-neutral-400">Test authorization and capture only. No real purchase advance, reimbursement or worker payout.</p>
      </header>
      {canceled && <p role="status">Checkout was canceled. This return link does not confirm funding.</p>}
      {!task && !error && <p role="status">Checking backend funding state…</p>}
      {error && <div className="space-y-3"><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="min-h-12 rounded-md border border-neutral-600 px-4">Retry verification</button></div>}
      {task && (
        <article className="space-y-5">
          <h2 className="text-xl font-medium">{task.prompt}</h2>
          <dl className="space-y-2 border-y border-neutral-700 py-4 text-sm">
            <div className="flex justify-between gap-3"><dt>Purchase allowance</dt><dd>${(task.purchase_allowance_cents / 100).toFixed(2)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Worker reward</dt><dd>${(task.worker_reward_cents / 100).toFixed(2)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Total</dt><dd>${(task.total_cents / 100).toFixed(2)}</dd></div>
          </dl>
          <section className="space-y-2" aria-live="polite">
            {funding === 'held' ? (
              <><h3 className="font-medium">Test funds authorized</h3><p className="text-neutral-400">Backend confirmed a Stripe test authorization. Funds are held, not captured.</p></>
            ) : funding === 'captured' ? (
              <><h3 className="font-medium">Test funds captured</h3><p className="text-neutral-400">Backend confirmed Stripe test capture. This is not a worker payout.</p></>
            ) : task.total_cents === 0 ? (
              <><h3 className="font-medium">No funding required</h3><p className="text-neutral-400">This task has a zero total.</p></>
            ) : (
              <><h3 className="font-medium">Funding not confirmed</h3><p className="text-neutral-400">Checking backend state every 1.5 seconds. Returning from Checkout alone does not authorize funds.</p></>
            )}
          </section>
          {task.total_cents > 0 && funding !== 'held' && funding !== 'captured' && task.funding?.checkout_url && <a href={task.funding.checkout_url} className="inline-flex min-h-12 items-center rounded-md bg-white px-4 font-medium text-black">Continue test Checkout</a>}
          <div className="flex flex-wrap gap-3 border-t border-neutral-700 pt-4">
            <a href={`/do?task=${encodeURIComponent(id)}`} className="inline-flex min-h-12 items-center rounded-md border border-neutral-600 px-4">Worker task</a>
            <a href="/board" className="inline-flex min-h-12 items-center rounded-md border border-neutral-600 px-4">Agent board</a>
          </div>
        </article>
      )}
    </main>
  );
}
