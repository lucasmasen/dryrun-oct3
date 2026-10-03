'use client';

import { useEffect, useRef, useState } from 'react';
import { ActionTaskViewSchema, ClaimTokenSchema, type ActionTaskView } from '@/lib/action/types';
import type { TaskView } from '@/lib/delegate/types';
import { decodeTaskView } from '@/lib/frontend/delegate/model';
import ActionWorker from './action-worker';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function load<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function deviceId(): string {
  let id = load<string>('device', '');
  if (typeof id !== 'string' || !id) { id = crypto.randomUUID(); save('device', id); }
  return id;
}

export default function WorkerTasks({ initialTaskId }: { initialTaskId: string | null }) {
  const [actions, setActions] = useState<ActionTaskView[]>([]);
  const [judgments, setJudgments] = useState<TaskView[]>([]);
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<{ kind: 'action' | 'judgment'; id: string } | null>(initialTaskId ? { kind: 'action', id: initialTaskId } : null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [judgmentError, setJudgmentError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    let reading = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (reading) return;
      reading = true;
      await Promise.all([
        (async () => {
          try {
            const response = await fetch('/api/action-tasks', { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('Action task list unavailable. Retrying…');
            const tasks = ActionTaskViewSchema.array().parse(await response.json());
            if (!active) return;
            setActions(tasks);
            setClaims(previous => {
              const next = { ...previous };
              for (const task of tasks) {
                const token = ClaimTokenSchema.safeParse(load<unknown>(`action:claim:${task.id}`, null));
                if (token.success) next[task.id] = token.data;
              }
              return next;
            });
            setActionError(null);
          } catch { if (active) setActionError('Action task list unavailable. Retrying…'); }
        })(),
        (async () => {
          try {
            const response = await fetch('/api/tasks', { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error('Judgment task list unavailable.');
            const body: unknown = await response.json();
            if (!Array.isArray(body)) throw new Error('Invalid judgment task list.');
            const tasks = body.map(decodeTaskView);
            if (tasks.some(task => !task)) throw new Error('Invalid judgment task list.');
            if (!active) return;
            setJudgments(tasks as TaskView[]);
            setJudgmentError(null);
          } catch { if (active) setJudgmentError('Judgment task list unavailable. Retrying…'); }
        })(),
      ]);
      reading = false;
      if (active) setLoaded(true);
    };
    void refresh();
    const interval = window.setInterval(refresh, 1500);
    return () => { active = false; controller.abort(); window.clearInterval(interval); };
  }, []);

  return (
    <main className="mx-auto min-h-svh max-w-lg space-y-7 bg-black px-5 py-8 text-white [&_button]:min-h-12 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-4 [&_button]:focus-visible:outline-white [&_input]:focus-visible:outline-2 [&_input]:focus-visible:outline-white [&_textarea]:focus-visible:outline-2 [&_textarea]:focus-visible:outline-white">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-400">Human tasks</p>
        <h1 className="text-3xl font-semibold tracking-tight">Help an agent.</h1>
        <p className="text-sm text-neutral-400">Action tasks require proof. Judgment tasks ask for your answer.</p>
        <p className="text-sm text-neutral-400">Action funding is Stripe TEST only. No real purchase advance, reimbursement or worker payout.</p>
      </header>
      {selected ? (
        <section className="space-y-5">
          <button type="button" onClick={() => setSelected(null)} className="text-neutral-400">← All tasks</button>
          {selected.kind === 'action' ? (
            <ActionWorker key={selected.id} id={selected.id} getDeviceId={deviceId} claimKey={`action:claim:${selected.id}`} onClaim={token => setClaims(previous => ({ ...previous, [selected.id]: token }))} />
          ) : (
            <JudgmentWorker key={selected.id} task={judgments.find(task => task.id === selected.id) ?? null} />
          )}
        </section>
      ) : (
        <>
          {!loaded && <p role="status">Loading tasks…</p>}
          <section className="space-y-3" aria-labelledby="action-tasks-heading">
            <h2 id="action-tasks-heading" className="text-xl font-medium">Action tasks</h2>
            {actionError && <p role="status" className="text-sm text-neutral-400">{actionError}</p>}
            <ul className="space-y-3">
              {actions.filter(task => task.status === 'open' || (claims[task.id] && (task.status === 'claimed' || task.status === 'verifying'))).map(task => (
                <li key={task.id}>
                  <button type="button" onClick={() => setSelected({ kind: 'action', id: task.id })} className="w-full rounded-lg border border-neutral-700 p-4 text-left hover:bg-neutral-900">
                    <span className="block text-lg font-medium">{task.prompt}</span>
                    <span className="mt-2 block text-sm text-neutral-400">{task.proof_type} proof · {task.status}</span>
                    <span className="mt-2 block text-sm">Purchase allowance {money(task.purchase_allowance_cents)} · Worker reward {money(task.worker_reward_cents)}</span>
                    <span className="mt-1 block text-xs text-neutral-400">Total {money(task.total_cents)} · TEST only</span>
                  </button>
                </li>
              ))}
            </ul>
            {loaded && !actionError && !actions.some(task => task.status === 'open' || (claims[task.id] && (task.status === 'claimed' || task.status === 'verifying'))) && <p className="text-sm text-neutral-400">No available action tasks.</p>}
          </section>
          <section className="space-y-3" aria-labelledby="judgment-tasks-heading">
            <h2 id="judgment-tasks-heading" className="text-xl font-medium">Judgment tasks</h2>
            {judgmentError && <p role="status" className="text-sm text-neutral-400">{judgmentError}</p>}
            <ul className="space-y-3">
              {judgments.filter(task => task.status === 'open').map(task => (
                <li key={task.id}>
                  <button type="button" onClick={() => setSelected({ kind: 'judgment', id: task.id })} className="w-full rounded-lg border border-neutral-700 p-4 text-left hover:bg-neutral-900">
                    <span className="block text-lg font-medium">{task.prompt}</span>
                    <span className="mt-2 block text-sm text-neutral-400">{task.response_type} · {task.responses_count} responses received · Budget {money(task.budget_cents)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {loaded && !judgmentError && !judgments.some(task => task.status === 'open') && <p className="text-sm text-neutral-400">No open judgment tasks.</p>}
          </section>
        </>
      )}
    </main>
  );
}

function JudgmentWorker({ task }: { task: TaskView | null }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const active = useRef(true);
  const taskId = task?.id;

  useEffect(() => {
    active.current = true;
    const savedName = load<unknown>('name', '');
    setName(typeof savedName === 'string' ? savedName : '');
    const saved = load<unknown>('answered', {});
    if (taskId && saved && typeof saved === 'object') setAnswered(taskId in saved);
    return () => { active.current = false; };
  }, [taskId]);

  async function submit(answer: string) {
    if (!task || busy.current || answered || task.status !== 'open') return;
    const value = answer.trim();
    if (task.response_type === 'choice' ? !task.options?.includes(answer) : value.length < 3 || value.length > 1000) {
      setMessage('Choose an option or enter 3–1000 characters.');
      return;
    }
    if (task.response_type === 'photo') return;
    busy.current = true;
    setSending(true);
    setMessage(null);
    save('name', name);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/responses`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: task.response_type === 'choice' ? answer : value, name: name.trim() || 'anon', device_id: deviceId() }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && /already/i.test(body.error ?? '')) {
        const previous = load<unknown>('answered', {});
        save('answered', { ...(previous && typeof previous === 'object' ? previous : {}), [task.id]: 0 });
        if (active.current) {
          setAnswered(true);
          setMessage('You already answered this task. One answer per person.');
        }
        return;
      }
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Response not confirmed.');
      if (body.ok !== true || typeof body.accepted !== 'boolean' || typeof body.reason !== 'string') throw new Error('Delivery unconfirmed. Resending may duplicate your response.');
      const previous = load<unknown>('answered', {});
      save('answered', { ...(previous && typeof previous === 'object' ? previous : {}), [task.id]: 0 });
      if (active.current) {
        setAnswered(true);
        setMessage(body.accepted ? 'Response received.' : `Not accepted: ${body.reason}`);
      }
    } catch (error) {
      if (active.current) setMessage(error instanceof Error ? error.message : 'Delivery unconfirmed. Resending may duplicate your response.');
    } finally {
      busy.current = false;
      if (active.current) setSending(false);
    }
  }

  if (!task) return <p role="status">Judgment task unavailable.</p>;
  return (
    <article className="space-y-4">
      <p className="text-xs uppercase tracking-wider text-neutral-400">Judgment · {task.status}</p>
      <h2 className="text-2xl font-semibold">{task.prompt}</h2>
      <p className="text-sm text-neutral-400">{task.responses_count} responses received · Budget {money(task.budget_cents)}</p>
      {task.status !== 'open' && <p>Task is no longer accepting responses.</p>}
      {answered && !message && <p>Already responded on this device.</p>}
      {task.status === 'open' && !answered && task.response_type !== 'photo' && (
        <>
          <label className="block space-y-2"><span>First name (optional)</span><input value={name} maxLength={40} onChange={event => setName(event.target.value)} disabled={sending} className="min-h-12 w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-base" /></label>
          {task.response_type === 'choice' ? (
            task.options?.length ? <div className="space-y-3">{task.options.map((option, index) => <button key={`${index}:${option}`} type="button" disabled={sending} onClick={() => void submit(option)} className="w-full rounded-md bg-white p-4 text-left text-lg text-black disabled:opacity-50">{option}</button>)}</div> : <p>Task options unavailable.</p>
          ) : (
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(text); }}>
              <label className="block space-y-2"><span>Your answer</span><textarea value={text} onChange={event => setText(event.target.value)} minLength={3} maxLength={1000} disabled={sending} className="min-h-32 w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-base" /></label>
              <button type="submit" disabled={sending || text.trim().length < 3} className="w-full rounded-md bg-white p-4 font-medium text-black disabled:opacity-50">{sending ? 'Sending…' : 'Send response'}</button>
            </form>
          )}
        </>
      )}
      {task.response_type === 'photo' && <p>Photo judgment responses are not supported here.</p>}
      {sending && <p role="status">Sending for verification…</p>}
      {message && <p role="status">{message}</p>}
    </article>
  );
}
