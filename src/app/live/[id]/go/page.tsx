'use client';

// Phone: volunteer for a live video task. If you're the one picked, start your
// camera and stream to the requester. Everyone else is told they're on standby.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import type { LiveView } from '@/lib/delegate/types';
import { startStreamer, type LiveState } from '@/lib/frontend/delegate/live-rtc';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}
function deviceId(): string { // same key as /do, so one phone = one claim
  let id = load<string>('device', '');
  if (!id) { id = crypto.randomUUID(); save('device', id); }
  return id;
}

export default function GoLivePage() {
  const { id } = useParams<{ id: string }>();
  const [info, setInfo] = useState<LiveView | null>(null);
  const [name, setName] = useState('');
  const [claimId, setClaimId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rtc, setRtc] = useState<LiveState | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopRtc = useRef<(() => void) | null>(null);

  const stopAll = useCallback(() => {
    stopRtc.current?.(); stopRtc.current = null;
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    setStreaming(false);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/tasks/${id}/live`, { cache: 'no-store' }).then(r => r.json());
      if (r?.id) setInfo(r);
      if (r?.status === 'closed') stopAll(); // requester ended the session
    } catch {}
  }, [id, stopAll]);

  useEffect(() => {
    // localStorage is client-only: read it after mount (async, so no render cascade)
    void Promise.resolve().then(() => {
      setName(load('name', ''));
      setClaimId(load<string | null>(`claim:${id}`, null));
    });
    const first = setTimeout(refresh, 0);
    const iv = setInterval(() => { refresh(); setNow(Date.now()); }, 1500);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, [id, refresh]);

  useEffect(() => stopAll, [stopAll]);

  const closed = info?.status === 'closed';

  async function volunteer() {
    setError(null);
    save('name', name);
    const res = await fetch(`/api/tasks/${id}/live`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'claim', name: name.trim() || 'anon', device_id: deviceId() }),
    });
    const body = await res.json().catch(() => ({}));
    if (body.claim_id) { setClaimId(body.claim_id); save(`claim:${id}`, body.claim_id); }
    if (!res.ok) setError(body.error ?? 'Something went wrong');
    refresh();
  }

  async function goLive() {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      stream.current = media;
      setStreaming(true);
      if (preview.current) { preview.current.srcObject = media; preview.current.play().catch(() => {}); }
      stopRtc.current = await startStreamer(id, media, setRtc);
      await fetch(`/api/tasks/${id}/live`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'started', claim_id: claimId }),
      });
    } catch (e) {
      stopAll();
      setError(e instanceof Error && /Permission|NotAllowed/i.test(e.name + e.message)
        ? 'Camera blocked. Allow camera + mic for this site, then try again.'
        : 'Could not start the camera or connect. Try again.');
    }
  }

  const picked = Boolean(claimId && info?.assigned?.claim_id === claimId);
  const someoneElse = Boolean(info?.assigned && !picked);
  const secsToPick = info?.selects_at ? Math.max(0, Math.ceil((new Date(info.selects_at).getTime() - now) / 1000)) : null;

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col gap-5 bg-neutral-950 px-5 py-7 text-stone-100">
      <p className="text-sm uppercase tracking-widest text-emerald-400">
        Live video task · {info ? money(info.budget_cents) : '…'} · 1 human
      </p>
      <h1 className="text-3xl font-semibold leading-tight tracking-tight text-balance">{info?.prompt ?? 'Loading…'}</h1>

      {/* Camera preview (shown once streaming) */}
      <div className={`relative overflow-hidden rounded-2xl bg-black ${streaming ? '' : 'hidden'}`}>
        <video ref={preview} autoPlay playsInline muted className="aspect-[3/4] w-full object-cover" />
        <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-sm font-bold ${rtc === 'live' ? 'bg-red-600' : 'bg-neutral-700'}`}>
          {rtc === 'live' ? '● LIVE: they can see you' : rtc === 'reconnecting' ? 'Reconnecting…' : 'Connecting to viewer…'}
        </span>
      </div>

      {closed ? (
        <div className="rounded-2xl bg-neutral-900 p-5">
          {picked && info?.result?.paid.total_cents
            ? <p className="text-2xl font-semibold text-emerald-400">Done! You earned {money(info.result.paid.total_cents)} 🎉</p>
            : <p className="text-xl text-neutral-300">This task has ended. Thanks for volunteering!</p>}
        </div>
      ) : !claimId ? (
        <>
          <input
            className="rounded-xl bg-neutral-800 p-4 text-lg outline-none focus-visible:outline-2 focus-visible:outline-white"
            placeholder="Your first name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button onClick={volunteer} disabled={someoneElse} className="rounded-xl bg-emerald-500 p-5 text-xl font-semibold text-black disabled:opacity-50">
            I can do this
          </button>
          <p className="text-sm text-neutral-500">
            {someoneElse ? 'Someone has already been picked for this one.' : "If several people volunteer, one is picked at random. You&apos;ll need your camera."}
          </p>
        </>
      ) : picked ? (
        !streaming && (
          <>
            <p className="text-2xl font-semibold text-emerald-400">You were picked! 🎉</p>
            <p className="text-neutral-300">Tap below to go live. Use your back camera, talk as you go, and keep it steady.</p>
            <button onClick={goLive} className="rounded-xl bg-red-600 p-5 text-xl font-semibold">● Go live</button>
          </>
        )
      ) : someoneElse ? (
        <p className="rounded-2xl bg-neutral-900 p-5 text-lg text-neutral-300">
          {info?.assigned?.name} was picked this time. You&apos;re on standby: thanks for volunteering!
        </p>
      ) : (
        <div className="rounded-2xl bg-neutral-900 p-5">
          <p className="text-xl font-semibold">You&apos;re in ✓</p>
          <p className="text-neutral-400">
            {info?.claims.length ?? 1} volunteer{info?.claims.length === 1 ? '' : 's'} so far · picking in {secsToPick ?? '…'}s
          </p>
        </div>
      )}

      {error && <p className="text-red-400">{error}</p>}
    </main>
  );
}
