'use client';

// Phone marketplace: every live task that AI agents have delegated, as tappable
// cards (pay, time, progress). Tap one to answer. Tracks your earnings locally.
import { useEffect, useState } from 'react';
import type { TaskView } from '@/lib/delegate/types';

const NEEDED = 3; // the MCP tool closes after 3 verified humans
const FRESH_MS = 15 * 60 * 1000; // hide stale test tasks
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const minutes = (t: TaskView) => (t.response_type === 'choice' ? '~10 sec' : t.response_type === 'photo' ? '~2 min' : '~30 sec');
const perHuman = (t: TaskView) => Math.floor(t.budget_cents / NEEDED);

type Answered = Record<string, number>; // taskId -> cents

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function deviceId(): string {
  let id = load<string>('device', '');
  if (!id) { id = crypto.randomUUID(); save('device', id); }
  return id;
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}

export default function DoPage() {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Answered>({});
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = () => { setAnswered(load('answered', {})); setName(load('name', '')); };
    init();
    const refresh = async () => {
      try {
        const all: TaskView[] = await fetch('/api/tasks', { cache: 'no-store' }).then(r => r.json());
        setTasks(all.filter(t => Date.now() - new Date(t.created_at).getTime() < FRESH_MS));
      } catch {}
    };
    refresh();
    const iv = setInterval(refresh, 2000);
    return () => clearInterval(iv);
  }, []);

  const live = tasks.filter(t => t.status === 'open');
  const current = tasks.find(t => t.id === openId) ?? null;
  const earned = Object.values(answered).reduce((a, b) => a + b, 0);
  const goal = Math.max(500, Math.ceil((earned + 1) / 500) * 500); // next $5 payout milestone
  const todo = live.filter(t => !(t.id in answered)).length;

  async function submit(answer: string) {
    if (!current || !answer.trim()) return;
    setSending(true); setError(null);
    save('name', name);
    const res = await fetch(`/api/tasks/${current.id}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer, name: name.trim() || 'anon', device_id: deviceId() }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (res.status === 409 && /already/i.test(body.error ?? '')) {
      const next = { ...answered, [current.id]: answered[current.id] ?? 0 };
      setAnswered(next); save('answered', next);
      return setError('You already answered this one. One answer per person.');
    }
    if (!res.ok) return setError(body.error ?? 'Something went wrong, try again');
    const next = { ...answered, [current.id]: body.accepted === false ? 0 : perHuman(current) };
    setAnswered(next); save('answered', next);
    setText('');
    if (body.accepted === false) setError(`Not accepted: ${body.reason ?? 'failed verification'}`);
    else setOpenId(null);
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col gap-6 bg-neutral-950 px-5 py-7 text-stone-100 [&_button]:transition-colors [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-white [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-white [&_textarea]:focus-visible:outline-2 [&_textarea]:focus-visible:outline-white">
      {/* Your payout progress */}
      <section className="rounded-2xl bg-neutral-900 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm uppercase tracking-widest text-neutral-400">Your earnings</span>
          <span className="text-2xl font-bold text-emerald-400">{money(earned)}</span>
        </div>
        <Bar value={earned} max={goal} tone="bg-emerald-400" />
        <p className="mt-1 text-xs text-neutral-500">
          {money(goal - earned)} to your next {money(goal)} payout · {todo} task{todo === 1 ? '' : 's'} available
        </p>
      </section>

      {!current && (
        <>
          <header>
            <p className="text-sm uppercase tracking-widest text-emerald-400">Live tasks from AI agents</p>
            <p className="text-neutral-400">Agents post these on their own while they work. Tap one to help.</p>
          </header>

          {live.length === 0 && <p className="mt-6 text-lg text-neutral-500">Waiting for an agent to delegate a task…</p>}

          <ul className="flex flex-col gap-3">
            {live.map(t => {
              const done = t.id in answered;
              const n = Math.min(t.responses_count, NEEDED);
              return (
                <li key={t.id}>
                  <button
                    disabled={done}
                    onClick={() => { setOpenId(t.id); setError(null); }}
                    className="w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-5 text-left hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-50"
                  >
                    <p className="line-clamp-2 text-lg font-semibold leading-snug">{t.prompt}</p>
                    <div className="mt-2 flex gap-3 text-sm">
                      <span className="font-semibold text-emerald-400">{money(perHuman(t))}</span>
                      <span className="text-neutral-400">{minutes(t)}</span>
                      <span className="text-neutral-500">{t.response_type === 'choice' ? 'Pick one' : 'Short answer'}</span>
                      {done && <span className="ml-auto text-emerald-400">✓ Done</span>}
                    </div>
                    <Bar value={n} max={NEEDED} tone="bg-sky-400" />
                    <p className="mt-1 text-xs text-neutral-500">Agent is waiting · {n}/{NEEDED} humans so far</p>
                  </button>
                </li>
              );
            })}
          </ul>

          {tasks.some(t => t.status === 'closed') && (
            <p className="text-center text-xs text-neutral-600">
              {tasks.filter(t => t.status === 'closed').length} task(s) completed and returned to agents in the last 15 min
            </p>
          )}
        </>
      )}

      {current && (
        <section className="flex flex-col gap-4">
          <button onClick={() => setOpenId(null)} className="self-start text-neutral-400">← All tasks</button>
          <p className="text-sm uppercase tracking-widest text-emerald-400">
            An AI agent needs a human · {money(perHuman(current))} · {minutes(current)}
          </p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-balance">{current.prompt}</h1>
          <div>
            <Bar value={Math.min(current.responses_count, NEEDED)} max={NEEDED} tone="bg-sky-400" />
            <p className="mt-1 text-xs text-neutral-500">
              {current.status === 'open'
                ? `${Math.min(current.responses_count, NEEDED)}/${NEEDED} humans · the agent continues when this fills`
                : 'Done: returned to the agent'}
            </p>
          </div>

          {current.status === 'open' && (
            <>
              <input
                className="rounded-xl bg-neutral-800 p-4 text-lg outline-none"
                placeholder="Your first name"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              {current.response_type === 'choice' && current.options?.length ? (
                <div className="flex flex-col gap-3">
                  {current.options.map(o => (
                    <button
                      key={o}
                      disabled={sending}
                      onClick={() => submit(o)}
                      className="rounded-xl bg-white p-5 text-xl font-semibold text-black active:scale-95 disabled:opacity-50"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <textarea
                    className="min-h-32 rounded-xl bg-neutral-800 p-4 text-lg outline-none"
                    placeholder="Your answer"
                    value={text}
                    onChange={e => setText(e.target.value)}
                  />
                  <button
                    disabled={sending || !text.trim()}
                    onClick={() => submit(text)}
                    className="rounded-xl bg-emerald-500 p-5 text-xl font-semibold text-black disabled:opacity-50"
                  >
                    {sending ? 'AI verifying…' : 'Submit'}
                  </button>
                </div>
              )}
            </>
          )}
          {error && <p className="text-red-400">{error}</p>}
        </section>
      )}
    </main>
  );
}

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
      <div className={`h-full rounded-full transition-all duration-700 ${tone}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}
