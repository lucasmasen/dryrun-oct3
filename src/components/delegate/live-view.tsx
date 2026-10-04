'use client';

// Viewer for live video tasks: QR to volunteer, volunteers list, auto-select
// countdown, the picked human's live camera, and "End & pay".
// Used by /live/[id] and by the board when the newest task is a live one.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { LiveView as Info } from '@/lib/delegate/types';
import { startViewer, type LiveState } from '@/lib/frontend/delegate/live-rtc';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const noop = () => () => {};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function LiveView({ taskId }: { taskId: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [rtc, setRtc] = useState<LiveState>('waiting');
  const [muted, setMuted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const origin = useSyncExternalStore(noop, () => location.origin, () => '');
  const video = useRef<HTMLVideoElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/tasks/${taskId}/live`, { cache: 'no-store' }).then(r => r.json());
      if (r?.id) setInfo(r);
    } catch {}
  }, [taskId]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const iv = setInterval(() => { refresh(); setNow(Date.now()); }, 1000);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, [refresh]);

  const closed = info?.status === 'closed';

  const loaded = info !== null;

  // Start listening as soon as the page loads (not only after a pick), so the
  // phone connects the moment it taps "Go live"
  useEffect(() => {
    if (!loaded || closed || !video.current) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    startViewer(taskId, video.current, setRtc)
      .then(s => (cancelled ? s() : (stop = s)))
      .catch(() => setRtc('error'));
    return () => { cancelled = true; stop?.(); };
  }, [taskId, loaded, closed]);

  const act = async (path: string, body?: object) => {
    setBusy(true);
    try {
      await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch {}
    setBusy(false);
    refresh();
  };

  const joinUrl = `${origin}/live/${taskId}/go`;
  const claims = info?.claims ?? [];
  const picked = info?.assigned;
  const regClosed = Boolean(info?.registration_closed_at);
  const secsToPick = info?.selects_at ? Math.max(0, Math.ceil((new Date(info.selects_at).getTime() - now) / 1000)) : null;
  const liveFor = info?.live_started_at ? Math.max(0, Math.floor((now - new Date(info.live_started_at).getTime()) / 1000)) : 0;
  const result = info?.result;

  return (
    <main className="min-h-svh bg-neutral-950 text-stone-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 px-6 py-4 lg:px-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-lg text-emerald-400">delegate_to_human()</span>
          <span className="text-neutral-500">· live video task</span>
        </div>
        {info && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-amber-500/15 px-3 py-1 font-semibold text-amber-300">
              {result ? `${money(result.paid.total_cents)} paid out` : `${money(info.budget_cents)} in escrow`}
            </span>
            {!closed && picked && (
              <button
                disabled={busy}
                onClick={() => act(`/api/tasks/${taskId}/close`)}
                className="rounded-full bg-white px-4 py-1 font-semibold text-black hover:bg-neutral-200 disabled:opacity-40"
              >
                {busy ? 'Paying…' : `End & pay ${picked.name} ${money(info.budget_cents)}`}
              </button>
            )}
          </div>
        )}
      </header>

      <div className="mx-auto grid max-w-[1800px] gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-12">
        <section className="flex min-w-0 flex-col gap-5">
          <div>
            <p className="mb-2 text-sm uppercase tracking-widest text-neutral-500">An AI agent hired a human to show it</p>
            <h1 className="max-w-[30ch] text-3xl font-semibold leading-tight tracking-tight text-balance lg:text-5xl">
              {info?.prompt ?? 'Loading…'}
            </h1>
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
            <video ref={video} autoPlay playsInline muted={muted} className={`h-full w-full object-contain ${picked && rtc === 'live' && !closed ? '' : 'invisible'}`} />

            {picked && rtc === 'live' && !closed && (
              <>
                <span className="absolute left-4 top-4 rounded-full bg-red-600 px-3 py-1 text-sm font-bold">
                  ● LIVE · {picked.name} · {clock(liveFor)}
                </span>
                {muted && (
                  <button onClick={() => setMuted(false)} className="absolute bottom-4 right-4 rounded-full bg-white/90 px-4 py-2 font-semibold text-black">
                    🔊 Unmute
                  </button>
                )}
              </>
            )}

            {!(picked && rtc === 'live') && !closed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                {!picked && claims.length === 0 && <p className="text-2xl text-neutral-400">Waiting for a human to volunteer…</p>}
                {!picked && claims.length > 0 && (
                  <>
                    <p className="text-2xl">{claims.length} human{claims.length === 1 ? '' : 's'} volunteered</p>
                    <p className="text-neutral-400">
                      {regClosed
                        ? `Registration closed · 🤖 Agent picking one at random in ${secsToPick ?? 0}s`
                        : 'Close registration when you have enough volunteers'}
                    </p>
                  </>
                )}
                {picked && (
                  <>
                    <p className="text-2xl">🤖 Agent picked {picked.name}</p>
                    <p className="text-neutral-400">
                      {rtc === 'ended' ? `${picked.name} finished the live video. Wrapping up…` : rtc === 'reconnecting' ? 'Reconnecting video…' : rtc === 'error' ? 'Video connection failed: check Realtime is enabled' : `Waiting for ${picked.name} to start their camera…`}
                    </p>
                  </>
                )}
              </div>
            )}

            {closed && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <p className="text-2xl text-neutral-400">Live session ended</p>
              </div>
            )}
          </div>

          {result && (
            <div className="flex flex-col gap-2 rounded-2xl border border-emerald-500/60 bg-emerald-500/5 p-6">
              <p className="text-sm uppercase tracking-widest text-emerald-400">Returned to the agent</p>
              <p className="text-lg">{result.summary}</p>
              <p className="text-neutral-400">
                Paid {money(result.paid.total_cents)}
                {result.paid.stripe && <span className="font-mono text-neutral-500"> · Stripe {result.paid.stripe}</span>}
              </p>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-5">
          {!picked && !closed && !regClosed && origin && (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Scan to take this task"
                className="h-56 w-56 rounded-xl bg-white p-3"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(joinUrl)}`}
              />
              <p className="text-xl font-semibold">Scan to take this task</p>
              <p className="text-center text-sm text-neutral-500">Get paid {info ? money(info.budget_cents) : ''} to go live</p>
            </div>
          )}

          <div className="rounded-2xl bg-neutral-900 p-4">
            <p className="mb-3 text-sm uppercase tracking-widest text-neutral-500">Volunteers</p>
            {claims.length === 0 && <p className="text-neutral-500">None yet</p>}
            <ul className="flex flex-col gap-2">
              {claims.map(c => (
                <li key={c.id} className={`flex items-center justify-between rounded-lg px-3 py-2 ${c.id === picked?.claim_id ? 'bg-emerald-500/15 text-emerald-300' : 'bg-neutral-800'}`}>
                  <span className="truncate">{c.name}</span>
                  <span className="text-sm">{c.id === picked?.claim_id ? '★ picked' : picked ? 'standby' : 'ready'}</span>
                </li>
              ))}
            </ul>
            {!picked && !closed && claims.length > 0 && !regClosed && (
              <button disabled={busy} onClick={() => act(`/api/tasks/${taskId}/live`, { action: 'close_registration' })} className="mt-3 w-full rounded-lg bg-white py-3 font-semibold text-black hover:bg-neutral-200 disabled:opacity-50">
                Close registration ({claims.length})
              </button>
            )}
            {!picked && !closed && regClosed && (
              <p className="mt-3 text-center text-neutral-400">🤖 Agent picking in {secsToPick ?? 0}s…</p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
