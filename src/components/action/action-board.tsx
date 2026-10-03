'use client';

import { useEffect, useState } from 'react';
import { ActionTaskViewSchema, type ActionTaskView } from '@/lib/action/types';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export default function ActionBoard() {
  const [tasks, setTasks] = useState<ActionTaskView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ActionTaskView | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/action-tasks', { cache: 'no-store' });
        if (!response.ok) throw new Error('Action tasks are temporarily unavailable.');
        const data: unknown = await response.json();
        if (!Array.isArray(data)) throw new Error('Action task response was invalid.');
        if (!active) return;
        const next = data.map(value => ActionTaskViewSchema.parse(value));
        setTasks(next);
        setListError(null);
        setSelectedId(current => current && next.some(task => task.id === current) ? current : next[0]?.id ?? null);
      } catch (error) {
        if (active) setListError(error instanceof Error ? error.message : 'Action tasks are temporarily unavailable.');
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 1500);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!selectedId) { setSelected(null); setDetailError(null); return; }
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/action-tasks/${encodeURIComponent(selectedId)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 404 ? 'Action task no longer exists.' : 'Task details are temporarily unavailable.');
        const data: unknown = await response.json();
        const task = ActionTaskViewSchema.parse(data);
        if (task.id !== selectedId) throw new Error('Action task response was invalid.');
        if (!active) return;
        setSelected(task);
        setDetailError(null);
      } catch (error) {
        if (active) setDetailError(error instanceof Error ? error.message : 'Task details are temporarily unavailable.');
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 1500);
    return () => { active = false; window.clearInterval(interval); };
  }, [selectedId]);

  return (
    <section className="border-t border-neutral-800 bg-neutral-950 px-6 py-8 text-stone-100 lg:px-10" aria-labelledby="action-board-title">
      <div className="mx-auto max-w-[1800px]">
        <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="action-board-title" className="text-xl font-medium tracking-tight">Action tasks</h2>
          <p className="font-mono text-xs uppercase tracking-wider text-neutral-500">Live · refreshes every 1.5s</p>
        </header>
        {listError && <p role="status" className="mb-4 text-sm text-neutral-400">{listError}</p>}
        <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.6fr)]">
          <ul className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto" aria-label="Action task list">
            {tasks.length === 0 && !listError && <li className="py-4 text-sm text-neutral-500">No action tasks yet.</li>}
            {tasks.map(task => (
              <li key={task.id}>
                <button
                  type="button"
                  aria-current={selectedId === task.id ? 'true' : undefined}
                  onClick={() => setSelectedId(task.id)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-100 ${selectedId === task.id ? 'border-neutral-500 bg-neutral-900' : 'border-neutral-800 hover:border-neutral-600'}`}
                >
                  <span className="block line-clamp-2 text-sm leading-5">{task.prompt}</span>
                  <span className="mt-2 block font-mono text-xs uppercase tracking-wide text-neutral-500">{task.status} · {task.proof_type}</span>
                </button>
              </li>
            ))}
          </ul>

          <article className="min-h-56 rounded-lg border border-neutral-800 p-5" aria-live="polite">
            {!selectedId && <p className="text-sm text-neutral-500">Select an action task to view details.</p>}
            {selectedId && detailError && <p role="status" className="text-sm text-neutral-400">{detailError}</p>}
            {selectedId && !detailError && (!selected || selected.id !== selectedId) && <p className="text-sm text-neutral-500">Loading action task…</p>}
            {selected && selected.id === selectedId && (
              <div className="space-y-5">
                <div>
                  <p className="font-mono text-xs uppercase tracking-wider text-neutral-500">{selected.status} · {selected.proof_type} proof</p>
                  <h3 className="mt-2 text-xl font-medium leading-snug">{selected.prompt}</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-300">{selected.proof_instructions}</p>
                </div>

                <dl className="grid gap-3 border-y border-neutral-800 py-4 text-sm sm:grid-cols-3">
                  <div><dt className="text-neutral-500">Purchase allowance</dt><dd className="mt-1 tabular-nums">{money(selected.purchase_allowance_cents)}</dd></div>
                  <div><dt className="text-neutral-500">Worker reward</dt><dd className="mt-1 tabular-nums">{money(selected.worker_reward_cents)}</dd></div>
                  <div><dt className="text-neutral-500">Funding</dt><dd className="mt-1">{selected.funding ? `TEST authorization/capture only · ${selected.funding.status}` : 'No funding required'}</dd></div>
                </dl>

                {selected.proof && (
                  <section className="space-y-2" aria-label="Submitted proof">
                    <h4 className="font-mono text-xs uppercase tracking-wider text-neutral-500">Proof · {selected.proof.status}</h4>
                    {selected.proof.text && <p className="whitespace-pre-wrap break-words text-sm leading-6">{selected.proof.text}</p>}
                    {selected.proof.photo_url && <img src={selected.proof.photo_url} alt={`Submitted photo proof for ${selected.prompt}`} className="max-h-80 max-w-full rounded-md border border-neutral-800 object-contain" />}
                    {selected.proof.reason && <p className="text-sm text-neutral-300">{selected.proof.status === 'rejected' ? 'Rejected' : selected.proof.status === 'accepted' ? 'Accepted' : 'Review'}: {selected.proof.reason}</p>}
                  </section>
                )}

                {selected.result && (
                  <section className="space-y-2 border-t border-neutral-800 pt-4" aria-label="Completed result">
                    <h4 className="font-mono text-xs uppercase tracking-wider text-neutral-500">Completed result</h4>
                    <p className="whitespace-pre-wrap text-sm leading-6">{selected.result.summary}</p>
                    {selected.result.proof_text && <p className="whitespace-pre-wrap break-words text-sm leading-6 text-neutral-300">{selected.result.proof_text}</p>}
                    {selected.result.photo_url && <img src={selected.result.photo_url} alt={`Verified result photo for ${selected.prompt}`} className="max-h-80 max-w-full rounded-md border border-neutral-800 object-contain" />}
                  </section>
                )}

                <a href={`/do?task=${encodeURIComponent(selected.id)}`} className="inline-flex min-h-11 items-center rounded-md border border-neutral-600 px-4 text-sm hover:bg-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-100">Open task on /do</a>
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
