'use client';

// Phone fulfillment page: shows the current open task, lets a human answer it.
import { useEffect, useState } from 'react';
import type { TaskView } from '@/lib/delegate/types';

export default function DoPage() {
  const [task, setTask] = useState<TaskView | null>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { setName(localStorage.getItem('name') ?? ''); } catch {}
    const load = async () => {
      try {
        const id = new URLSearchParams(location.search).get('id');
        const t = id
          ? await fetch(`/api/tasks/${id}`, { cache: 'no-store' }).then(r => r.json())
          : (await fetch('/api/tasks?status=open', { cache: 'no-store' }).then(r => r.json()))[0];
        setTask(t?.id ? t : null);
      } catch {}
    };
    load();
    const iv = setInterval(load, 2000);
    return () => clearInterval(iv);
  }, []);

  async function submit(answer: string) {
    if (!task || !answer.trim()) return;
    setSending(true); setError(null);
    try { localStorage.setItem('name', name); } catch {}
    const res = await fetch(`/api/tasks/${task.id}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer, name: name.trim() || 'anon' }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) return setError(body.error ?? 'Something went wrong, try again');
    setDoneFor(task.id); setText('');
  }

  const perHuman = task ? Math.floor(task.budget_cents / 3) : 0;

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-5 flex flex-col gap-5 max-w-md mx-auto">
      <header className="text-sm uppercase tracking-widest text-emerald-400">An AI agent needs a human</header>

      {!task && <p className="text-xl text-neutral-400 mt-10">Waiting for the next task…</p>}

      {task && doneFor === task.id && (
        <div className="mt-10 flex flex-col gap-3">
          <p className="text-4xl">✅</p>
          <p className="text-2xl font-semibold">Thanks! Your answer is on the board.</p>
          <p className="text-neutral-400">You&apos;ll be paid if it passes verification. Keep this page open for the next task.</p>
        </div>
      )}

      {task && doneFor !== task.id && task.status !== 'open' && (
        <p className="text-xl text-neutral-400 mt-10">This task just closed. Waiting for the next one…</p>
      )}

      {task && doneFor !== task.id && task.status === 'open' && (
        <>
          <h1 className="text-3xl font-bold leading-tight">{task.prompt}</h1>
          <p className="text-emerald-400">Earn about ${(perHuman / 100).toFixed(2)} · {task.responses_count} answered so far</p>
          <input
            className="rounded-xl bg-neutral-800 p-4 text-lg outline-none"
            placeholder="Your first name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          {task.response_type === 'choice' && task.options?.length ? (
            <div className="flex flex-col gap-3">
              {task.options.map(o => (
                <button
                  key={o}
                  disabled={sending}
                  onClick={() => submit(o)}
                  className="rounded-xl bg-white text-black p-5 text-xl font-semibold active:scale-95 disabled:opacity-50"
                >
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <textarea
                className="rounded-xl bg-neutral-800 p-4 text-lg outline-none min-h-32"
                placeholder="Your answer"
                value={text}
                onChange={e => setText(e.target.value)}
              />
              <button
                disabled={sending || !text.trim()}
                onClick={() => submit(text)}
                className="rounded-xl bg-emerald-500 text-black p-5 text-xl font-semibold disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Submit'}
              </button>
            </div>
          )}
          {error && <p className="text-red-400">{error}</p>}
        </>
      )}
    </main>
  );
}
