'use client';

// Big-screen board: latest task, answers streaming in, verification, payout.
// Realtime for instant updates, plus a 1.5s poll so it never goes stale.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { TaskView } from '@/lib/delegate/types';

type Row = { answer: string; name: string; status: 'pending' | 'accepted' | 'rejected'; reason: string | null; created_at: string };

export default function BoardPage() {
  const [task, setTask] = useState<TaskView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [origin, setOrigin] = useState('');
  const taskId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const id = new URLSearchParams(location.search).get('id');
      const t: TaskView | undefined = id
        ? await fetch(`/api/tasks/${id}`, { cache: 'no-store' }).then(r => r.json())
        : (await fetch('/api/tasks', { cache: 'no-store' }).then(r => r.json()))[0];
      if (!t?.id) return;
      taskId.current = t.id;
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
  const accepted = rows.filter(r => r.status === 'accepted');
  const tally: Record<string, number> = result?.tally ?? {};
  if (!result) for (const r of accepted) tally[r.answer] = (tally[r.answer] ?? 0) + 1;
  const max = Math.max(1, ...Object.values(tally));

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-10 grid grid-cols-[1fr_320px] gap-10">
      <section className="flex flex-col gap-6 min-w-0">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 rounded-full ${task?.status === 'open' ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-500'}`} />
          <span className="uppercase tracking-widest text-sm text-neutral-400">
            delegate_to_human() · {task ? task.status : 'waiting for an agent'}
          </span>
        </div>
        <h1 className="text-5xl font-bold leading-tight">{task?.prompt ?? 'Waiting for an agent to delegate a task…'}</h1>
        {task && (
          <p className="text-xl text-emerald-400">
            ${(task.budget_cents / 100).toFixed(2)} held in escrow · {rows.length} responses
          </p>
        )}

        {Object.keys(tally).length > 0 && (
          <div className="flex flex-col gap-2">
            {Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="flex items-center gap-4">
                <span className="w-56 truncate text-xl">{k}</span>
                <div className="h-8 bg-emerald-500 rounded transition-all duration-500" style={{ width: `${(v / max) * 60}%` }} />
                <span className="text-xl font-semibold">{v}</span>
              </div>
            ))}
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {[...rows].reverse().map((r, i) => (
            <li key={r.created_at + i} className="rounded-xl bg-neutral-900 p-4 flex items-start gap-4 animate-[fadeIn_.4s_ease-out]">
              <span className="text-2xl">{r.status === 'accepted' ? '✅' : r.status === 'rejected' ? '🚫' : '⏳'}</span>
              <div className="min-w-0">
                <p className={`text-2xl ${r.status === 'rejected' ? 'line-through text-neutral-500' : ''}`}>{r.answer}</p>
                <p className="text-neutral-400">
                  {r.name}
                  {r.status === 'pending' && ' · verifying…'}
                  {r.status === 'rejected' && r.reason && ` · rejected: ${r.reason}`}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {result && (
          <div className="rounded-2xl border border-emerald-500 p-6 flex flex-col gap-2">
            <p className="uppercase tracking-widest text-sm text-emerald-400">Returned to the agent</p>
            <p className="text-3xl font-bold">{result.summary}</p>
            <p className="text-xl text-neutral-300">
              Paid ${(result.paid.total_cents / 100).toFixed(2)} · ${(result.paid.per_human_cents / 100).toFixed(2)} per verified human
              {result.paid.stripe && <span className="text-neutral-500"> · Stripe {result.paid.stripe}</span>}
            </p>
          </div>
        )}
      </section>

      <aside className="flex flex-col items-center gap-4 pt-10">
        {origin && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="Scan to answer"
            className="rounded-xl bg-white p-3 w-72 h-72"
            src={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(doUrl)}`}
          />
        )}
        <p className="text-2xl font-semibold">Scan to answer</p>
        <p className="text-neutral-400 break-all text-center">{doUrl.replace(/^https?:\/\//, '')}</p>
      </aside>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}`}</style>
    </main>
  );
}
