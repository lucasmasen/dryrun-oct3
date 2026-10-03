'use client';

// Big-screen board: current task, answers streaming in, verification, payout.
// Realtime for instant updates, plus a 1.5s poll so it never goes stale.
// Shows the newest OPEN task; if none is open, the most recent one.
import { useCallback, useEffect, useState } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { TaskView } from '@/lib/delegate/types';

type Row = { answer: string; name: string; status: 'pending' | 'accepted' | 'rejected'; reason: string | null; created_at: string };

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function BoardPage() {
  const [task, setTask] = useState<TaskView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [origin, setOrigin] = useState('');

  const refresh = useCallback(async () => {
    try {
      const id = new URLSearchParams(location.search).get('id');
      let t: TaskView | undefined;
      if (id) t = await fetch(`/api/tasks/${id}`, { cache: 'no-store' }).then(r => r.json());
      else {
        const all: TaskView[] = await fetch('/api/tasks', { cache: 'no-store' }).then(r => r.json());
        t = all.find(x => x.status !== 'closed') ?? all[0];
      }
      if (!t?.id) return;
      setTask(t);
      const r = await fetch(`/api/tasks/${t.id}/responses`, { cache: 'no-store' }).then(r => r.json());
      if (Array.isArray(r)) setRows(r);
    } catch {}
  }, []);

  useEffect(() => {
    setOrigin(location.origin);
    refresh();
    const iv = setInterval(refresh, 1500);
    let channel: RealtimeChannel | undefined;
    fetch('/api/realtime').then(r => r.json()).then(({ url, anonKey }) => {
      if (!url || !anonKey) return;
      const sb = createClient(String(url).replace(/\/rest\/v1\/?$/, ''), anonKey);
      channel = sb.channel('board')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'responses' }, () => refresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => refresh())
        .subscribe();
    }).catch(() => {});
    return () => { clearInterval(iv); channel?.unsubscribe(); };
  }, [refresh]);

  const doUrl = `${origin}/do`;
  const result = task?.result;
  const isChoice = task?.response_type === 'choice' && !!task.options?.length;
  const accepted = rows.filter(r => r.status === 'accepted');
  const rejected = rows.filter(r => r.status === 'rejected');

  // Every option gets a bar from the start (at 0) so the bars visibly grow.
  const tally: Record<string, number> = {};
  if (isChoice) for (const o of task!.options!) tally[o] = 0;
  for (const r of accepted) if (isChoice) tally[r.answer] = (tally[r.answer] ?? 0) + 1;
  const maxVotes = Math.max(1, ...Object.values(tally));
  const leader = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];

  const open = task?.status === 'open';

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 px-6 py-4 lg:px-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg text-emerald-400">delegate_to_human()</span>
          <span className="text-neutral-500">· live</span>
        </div>
        {task && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={`rounded-full px-3 py-1 font-semibold ${open ? 'bg-emerald-500/15 text-emerald-300' : 'bg-neutral-800 text-neutral-300'}`}>
              {open ? '● Open: humans answering' : task.status === 'closing' ? 'Verifying…' : '✓ Complete: returned to agent'}
            </span>
            <span className="rounded-full bg-amber-500/15 px-3 py-1 font-semibold text-amber-300">
              {money(task.budget_cents)} {result ? 'paid out' : 'in escrow'}
            </span>
          </div>
        )}
      </header>

      <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1fr_300px] lg:px-10">
        <section className="flex min-w-0 flex-col gap-8">
          <div>
            <p className="mb-2 text-sm uppercase tracking-widest text-neutral-500">An AI agent asked humans</p>
            <h1 className="text-4xl font-bold leading-tight lg:text-5xl">
              {task?.prompt ?? 'Waiting for an agent to delegate a task…'}
            </h1>
          </div>

          {task && (
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Responses" value={rows.length} />
              <Stat label="Verified" value={accepted.length} tone="text-emerald-400" />
              <Stat label="Rejected" value={rejected.length} tone="text-red-400" />
            </div>
          )}

          {isChoice && (
            <div className="flex flex-col gap-3">
              {Object.entries(tally).map(([opt, n]) => {
                const lead = n > 0 && leader && opt === leader[0];
                return (
                  <div key={opt} className="flex items-center gap-4">
                    <span className={`w-40 shrink-0 truncate text-xl lg:w-64 ${lead ? 'font-bold' : 'text-neutral-300'}`}>{opt}</span>
                    <div className="h-10 flex-1 overflow-hidden rounded-lg bg-neutral-900">
                      <div
                        className={`h-full rounded-lg transition-all duration-700 ease-out ${lead ? 'bg-emerald-400' : 'bg-emerald-700'}`}
                        style={{ width: `${(n / maxVotes) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-2xl font-bold tabular-nums">{n}</span>
                  </div>
                );
              })}
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-2 rounded-2xl border border-emerald-500/60 bg-emerald-500/5 p-6">
              <p className="text-sm uppercase tracking-widest text-emerald-400">Returned to the agent</p>
              <p className="text-3xl font-bold">{result.winner}</p>
              <p className="text-lg text-neutral-300">{result.summary}</p>
              <p className="text-neutral-400">
                Paid {money(result.paid.total_cents)} · {money(result.paid.per_human_cents)} per verified human
                {result.paid.stripe && <span className="font-mono text-neutral-500"> · Stripe {result.paid.stripe}</span>}
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-2">
              {[...rows].reverse().map((r, i) => (
                <li
                  key={r.created_at + i}
                  className={`flex items-start gap-3 rounded-xl p-4 animate-[fadeIn_.4s_ease-out] ${
                    r.status === 'rejected' ? 'bg-red-500/10' : 'bg-neutral-900'
                  }`}
                >
                  <span className="text-2xl">{r.status === 'accepted' ? '✅' : r.status === 'rejected' ? '🚫' : '⏳'}</span>
                  <div className="min-w-0">
                    <p className={`break-words text-xl ${r.status === 'rejected' ? 'text-neutral-500 line-through' : ''}`}>{r.answer}</p>
                    <p className="text-sm text-neutral-400">
                      {r.name}
                      {r.status === 'pending' && ' · AI verifying…'}
                      {r.status === 'accepted' && ' · verified'}
                      {r.status === 'rejected' && ` · rejected${r.reason ? `: ${r.reason}` : ''}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="flex flex-col items-center gap-3 lg:pt-6">
          {origin && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Scan to answer"
              className="h-56 w-56 rounded-xl bg-white p-3 lg:h-64 lg:w-64"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(doUrl)}`}
            />
          )}
          <p className="text-2xl font-semibold">Scan to answer</p>
          <p className="break-all text-center text-neutral-400">{doUrl.replace(/^https?:\/\//, '')}</p>
          <p className="text-center text-sm text-neutral-500">Get paid for verified answers</p>
        </aside>
      </div>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}`}</style>
    </main>
  );
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-neutral-900 p-4">
      <p className={`text-4xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-sm uppercase tracking-wider text-neutral-500">{label}</p>
    </div>
  );
}
