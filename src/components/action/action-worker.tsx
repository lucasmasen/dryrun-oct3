'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { ActionProofTextSchema, ActionTaskIdSchema, ActionTaskViewSchema, ClaimTokenSchema, type ActionTaskView } from '@/lib/action/types';

const claimReceipt = z.object({ claim_token: ClaimTokenSchema, task: ActionTaskViewSchema });
const proofReceipt = z.object({ accepted: z.boolean(), reason: z.string(), task: ActionTaskViewSchema });

export default function ActionWorker({ id, getDeviceId, claimKey, onClaim }: {
  id: string;
  getDeviceId: () => string;
  claimKey: string;
  onClaim: (token: string) => void;
}) {
  const [task, setTask] = useState<ActionTaskView | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const posting = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    try {
      const stored = localStorage.getItem(claimKey);
      const parsed = ClaimTokenSchema.safeParse(stored ? JSON.parse(stored) : null);
      if (parsed.success) setToken(parsed.data);
    } catch { setStorageWarning('Claim storage unavailable. Keep this page open if you claim a task.'); }
    let reading = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (reading || posting.current) return;
      if (!ActionTaskIdSchema.safeParse(id).success) { setReadError('Action task ID is invalid.'); return; }
      reading = true;
      const version = revision.current;
      try {
        const response = await fetch(`/api/action-tasks/${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? 'Action task not found.' : 'Task refresh failed. Last shown state may be stale; retrying…');
        const next = ActionTaskViewSchema.parse(await response.json());
        if (next.id !== id) throw new Error('Invalid task response.');
        if (mounted.current && version === revision.current && !posting.current) {
          setTask(next);
          setReadError(null);
          if (next.status === 'completed') setError(null);
        }
      } catch (failure) {
        if (mounted.current && version === revision.current) setReadError(failure instanceof Error ? failure.message : 'Task refresh failed. Retrying…');
      } finally { reading = false; }
    };
    void refresh();
    const interval = window.setInterval(refresh, 1500);
    return () => { mounted.current = false; controller.abort(); window.clearInterval(interval); };
  }, [id, claimKey]);

  async function claim() {
    if (!task || task.status !== 'open' || token || posting.current || readError) return;
    posting.current = true;
    revision.current++;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/action-tasks/${encodeURIComponent(id)}/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_id: getDeviceId() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Claim not confirmed. No automatic retry.');
      const receipt = claimReceipt.parse(body);
      if (receipt.task.id !== id) throw new Error('Invalid claim response.');
      let saved = true;
      try { localStorage.setItem(claimKey, JSON.stringify(receipt.claim_token)); } catch { saved = false; }
      onClaim(receipt.claim_token);
      if (!mounted.current) return;
      setToken(receipt.claim_token);
      setTask(receipt.task);
      setStorageWarning(saved ? null : 'Claim could not be saved. Keep this page open; reloading loses proof access.');
    } catch (failure) {
      if (mounted.current) setError(failure instanceof z.ZodError ? 'Claim response invalid. Claim may have succeeded; no automatic retry.' : failure instanceof Error ? failure.message : 'Claim delivery unconfirmed. No automatic retry.');
    } finally {
      revision.current++;
      posting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function submitProof() {
    if (!task || !token || task.status !== 'claimed' || posting.current || readError) return;
    const parsedText = ActionProofTextSchema.safeParse(text);
    if (task.proof_type === 'text' && !parsedText.success) { setError('Enter 3–4000 characters of text proof.'); return; }
    if (task.proof_type === 'photo' && (!photo || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 4 * 1024 * 1024 || photo.size === 0)) {
      setError('Choose a JPEG, PNG or WebP photo, up to 4 MB.');
      return;
    }
    const data = new FormData();
    data.set('claim_token', token);
    if (task.proof_type === 'text' && parsedText.success) data.set('text', parsedText.data);
    if (task.proof_type === 'photo' && photo) data.set('photo', photo);
    posting.current = true;
    revision.current++;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/action-tasks/${encodeURIComponent(id)}/proof`, { method: 'POST', body: data });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 503) throw new Error(typeof body?.error === 'string' ? body.error : 'Verification unavailable. Proof has not been accepted. Try again when task returns to claimed.');
        throw new Error(typeof body?.error === 'string' ? body.error : 'Proof delivery unconfirmed. Check task state before resending.');
      }
      const receipt = proofReceipt.parse(body);
      if (receipt.task.id !== id) throw new Error('Invalid proof response.');
      if (!mounted.current) return;
      setTask(receipt.task);
      if (receipt.task.status === 'completed') { setText(''); setPhoto(null); }
      else if (receipt.task.proof?.status === 'rejected') setError(receipt.task.proof.reason ?? receipt.reason);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof z.ZodError ? 'Proof delivery unconfirmed. Checking backend task state before completion.' : failure instanceof Error ? failure.message : 'Proof delivery unconfirmed. Check task state before resending.');
    } finally {
      revision.current++;
      posting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <article className="space-y-5">
      {readError && <p role="status" className="text-neutral-400">{readError}</p>}
      {!task && !readError && <p role="status">Loading action task…</p>}
      {task && (
        <>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-neutral-400">Action · {task.status} · {task.proof_type} proof</p>
            <h2 className="text-2xl font-semibold leading-tight">{task.prompt}</h2>
          </div>
          <section className="space-y-2" aria-label="Agent proof instructions">
            <h3 className="font-medium">Agent proof instructions</h3>
            <p className="whitespace-pre-wrap break-words text-neutral-300">{task.proof_instructions}</p>
          </section>
          <dl className="space-y-2 border-y border-neutral-700 py-4 text-sm">
            <div className="flex justify-between gap-3"><dt>Purchase allowance</dt><dd>${(task.purchase_allowance_cents / 100).toFixed(2)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Worker reward</dt><dd>${(task.worker_reward_cents / 100).toFixed(2)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Total</dt><dd>${(task.total_cents / 100).toFixed(2)}</dd></div>
            <div className="flex justify-between gap-3"><dt>Stripe TEST funding</dt><dd>{task.funding?.status ?? 'Not required'}</dd></div>
          </dl>
          <p className="text-sm text-neutral-400">TEST only. These amounts do not represent a real advance, reimbursement or worker payout.</p>
          {task.status === 'awaiting_funding' && <p>Waiting for requester test funding. Task cannot be claimed yet.</p>}
          {task.status === 'open' && !token && <button type="button" disabled={busy || !!readError} onClick={() => void claim()} className="w-full rounded-md bg-white p-4 font-medium text-black disabled:opacity-50">{busy ? 'Claiming…' : 'Claim this task'}</button>}
          {task.status === 'open' && token && <p>Saved claim does not match current task state. Waiting for backend refresh.</p>}
          {(task.status === 'claimed' || task.status === 'verifying') && !token && <p>This task is claimed. Proof access requires the private claim saved on the claiming browser.</p>}
          {task.proof?.status === 'rejected' && <p role="status">Proof rejected: {task.proof.reason ?? 'Proof did not meet the agent instructions.'} {token && 'Correct your proof and resubmit.'}</p>}
          {token && task.status === 'claimed' && (
            <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submitProof(); }}>
              {task.proof_type === 'text' ? (
                <label className="block space-y-2"><span>Text proof · 3–4000 characters</span><textarea value={text} onChange={event => setText(event.target.value)} disabled={busy} minLength={3} maxLength={4000} required className="min-h-40 w-full rounded-md border border-neutral-700 bg-neutral-900 p-3 text-base" /></label>
              ) : (
                <label className="block space-y-2"><span>Photo proof · JPEG, PNG or WebP · max 4 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} required onChange={event => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024 || file.size === 0)) {
                    setPhoto(null); event.target.value = ''; setError('Choose a JPEG, PNG or WebP photo, up to 4 MB.');
                  } else { setPhoto(file); setError(null); }
                }} className="min-h-12 w-full rounded-md border border-neutral-700 p-3 text-base file:mr-3 file:text-white" /></label>
              )}
              <button type="submit" disabled={busy || !!readError || (task.proof_type === 'text' ? !ActionProofTextSchema.safeParse(text).success : !photo)} className="w-full rounded-md bg-white p-4 font-medium text-black disabled:opacity-50">{busy ? 'Sending for verification…' : 'Submit proof'}</button>
            </form>
          )}
          {task.status === 'verifying' && <p role="status">Verifying proof… This page checks backend state automatically.</p>}
          {task.status === 'completed' && <section className="space-y-2 border-t border-neutral-700 pt-4" aria-label="Completed action" role="status"><h3 className="text-xl font-medium">Action completed</h3>{task.result && <p className="whitespace-pre-wrap break-words">{task.result.summary}</p>}<p className="text-sm text-neutral-400">Backend confirmed completion. No real worker payout.</p></section>}
        </>
      )}
      {storageWarning && <p role="status" className="text-sm text-neutral-400">{storageWarning}</p>}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
