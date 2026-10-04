'use client';
// Phone camera -> viewer, peer to peer over WebRTC (TURN relay when configured).
// Signaling rides on a Supabase Realtime broadcast channel `live:<taskId>`.
//
// Fast path (trickle ICE): offer/answer are sent immediately and network
// candidates follow one by one as they're found, so video starts as soon as the
// first working route is known instead of after a fixed gathering wait.
//   viewer   -> 'viewer-ready'   (on join, every 1s while unconnected, and on 'streamer-ready')
//   streamer -> 'streamer-ready' (on join, so a waiting viewer answers instantly)
//   streamer -> 'offer'          (for that viewer)
//   viewer   -> 'answer'
//   both     -> 'ice'            (candidates, tagged with the session)
// A viewer reload or a dropped connection just restarts the handshake.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// STUN by default; /api/realtime adds a TURN relay when one is configured.
let ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export type LiveState = 'connecting' | 'waiting' | 'live' | 'reconnecting' | 'ended' | 'error';

type Signal =
  | { kind: 'viewer-ready'; viewer: string }
  | { kind: 'streamer-ready' }
  | { kind: 'offer'; viewer: string; session: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; viewer: string; session: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: 'viewer' | 'streamer'; session: string; candidate: RTCIceCandidateInit }
  | { kind: 'bye' };

let client: Promise<SupabaseClient> | null = null;
function supabase(): Promise<SupabaseClient> {
  client ??= fetch('/api/realtime', { cache: 'no-store' })
    .then(r => r.json())
    .then(({ url, anonKey, iceServers }) => {
      if (!url || !anonKey) throw new Error('Realtime is not configured');
      if (Array.isArray(iceServers) && iceServers.length) ICE = iceServers;
      return createClient(String(url).replace(/\/rest\/v1\/?$/, ''), anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    })
    .catch(e => { client = null; throw e; });
  return client;
}

/** Call on page load: fetches config + TURN credentials early so "Go live" connects faster. */
export function warmUp() {
  supabase().catch(() => {});
}

async function channel(taskId: string, onSignal: (s: Signal) => void) {
  const sb = await supabase(); // also loads ICE (incl. TURN) before any peer connection
  const ch = sb.channel(`live:${taskId}`, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload as Signal));
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Realtime timed out')), 10000);
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); reject(new Error(status)); }
    });
  });
  return {
    send: (s: Signal) => { void ch.send({ type: 'broadcast', event: 'signal', payload: s }); },
    close: () => { void sb.removeChannel(ch); },
  };
}

const dead = (pc: RTCPeerConnection | null) =>
  !pc || ['failed', 'closed', 'disconnected'].includes(pc.connectionState);

/** Remote candidates can arrive before the description they belong to: buffer them. */
function candidateQueue() {
  const pending = new Map<string, RTCIceCandidateInit[]>();
  return {
    add(pc: RTCPeerConnection | null, session: string, current: string, c: RTCIceCandidateInit) {
      if (pc && session === current && pc.remoteDescription) {
        pc.addIceCandidate(c).catch(() => {});
      } else {
        pending.set(session, [...(pending.get(session) ?? []), c]);
      }
    },
    flush(pc: RTCPeerConnection, session: string) {
      for (const c of pending.get(session) ?? []) pc.addIceCandidate(c).catch(() => {});
      pending.delete(session);
    },
  };
}

/** Viewer (requester / big screen). Safe to start before anyone is picked. Returns a stop function. */
export async function startViewer(taskId: string, video: HTMLVideoElement, onState: (s: LiveState) => void) {
  const viewer = crypto.randomUUID();
  let pc: RTCPeerConnection | null = null;
  let session = '';
  const queue = candidateQueue();
  onState('connecting');

  const ch = await channel(taskId, async s => {
    if (s.kind === 'bye') { onState('ended'); return; }
    if (s.kind === 'streamer-ready') { setTimeout(ping, 0); return; }
    if (s.kind === 'ice') { if (s.from === 'streamer') queue.add(pc, s.session, session, s.candidate); return; }
    if (s.kind !== 'offer' || s.viewer !== viewer) return;

    pc?.close();
    const mine = new RTCPeerConnection({ iceServers: ICE });
    pc = mine;
    session = s.session;
    const mySession = s.session;
    mine.ontrack = e => {
      if (video.srcObject !== e.streams[0]) {
        video.srcObject = e.streams[0];
        video.play().catch(() => {});
      }
    };
    mine.onicecandidate = e => {
      if (e.candidate && pc === mine) ch.send({ kind: 'ice', from: 'viewer', session: mySession, candidate: e.candidate.toJSON() });
    };
    mine.onconnectionstatechange = () => {
      if (pc !== mine) return;
      if (mine.connectionState === 'connected') onState('live');
      else if (dead(mine)) onState('reconnecting');
    };
    try {
      await mine.setRemoteDescription(s.sdp);
      queue.flush(mine, mySession);
      await mine.setLocalDescription(await mine.createAnswer());
      if (pc === mine) ch.send({ kind: 'answer', viewer, session: mySession, sdp: mine.localDescription!.toJSON() });
    } catch {
      onState('reconnecting');
    }
  });

  function ping() { if (dead(pc)) ch.send({ kind: 'viewer-ready', viewer }); }
  onState('waiting');
  ping();
  const iv = setInterval(ping, 1000);
  return () => { clearInterval(iv); pc?.close(); ch.close(); };
}

/** Streamer (the picked phone). Call after getUserMedia. Returns a stop function. */
export async function startStreamer(taskId: string, stream: MediaStream, onState: (s: LiveState) => void) {
  let pc: RTCPeerConnection | null = null;
  let session = '';
  let last = { viewer: '', at: 0 };
  const queue = candidateQueue();
  onState('connecting');

  const ch = await channel(taskId, async s => {
    if (s.kind === 'viewer-ready') {
      const st = pc?.connectionState;
      if (st === 'connected' || st === 'connecting') return;               // already serving a viewer
      if (last.viewer === s.viewer && Date.now() - last.at < 6000) return; // handshake in flight
      last = { viewer: s.viewer, at: Date.now() };
      pc?.close();
      const mine = new RTCPeerConnection({ iceServers: ICE });
      pc = mine;
      session = crypto.randomUUID();
      const mySession = session;
      stream.getTracks().forEach(t => mine.addTrack(t, stream));
      mine.onicecandidate = e => {
        if (e.candidate && pc === mine) ch.send({ kind: 'ice', from: 'streamer', session: mySession, candidate: e.candidate.toJSON() });
      };
      mine.onconnectionstatechange = () => {
        if (pc !== mine) return;
        if (mine.connectionState === 'connected') onState('live');
        else if (dead(mine)) onState('reconnecting');
      };
      await mine.setLocalDescription(await mine.createOffer());
      if (pc === mine) ch.send({ kind: 'offer', viewer: s.viewer, session: mySession, sdp: mine.localDescription!.toJSON() });
    } else if (s.kind === 'answer' && pc && s.session === session) {
      try {
        await pc.setRemoteDescription(s.sdp);
        queue.flush(pc, session);
      } catch {
        onState('reconnecting');
      }
    } else if (s.kind === 'ice' && s.from === 'viewer') {
      queue.add(pc, s.session, session, s.candidate);
    }
  });

  onState('waiting');
  ch.send({ kind: 'streamer-ready' }); // a viewer already listening replies right away
  return () => { ch.send({ kind: 'bye' }); pc?.close(); ch.close(); };
}
