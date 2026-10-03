'use client';
// Phone camera -> viewer, peer to peer over WebRTC.
// Signaling (the SDP handshake) rides on a Supabase Realtime broadcast channel
// `live:<taskId>`, so there's no extra server. ICE is gathered fully before
// sending (no trickle) to keep the protocol to three messages:
//   viewer  -> 'viewer-ready'  (repeated every 2s until it has a connection)
//   phone   -> 'offer'         (for that viewer)
//   viewer  -> 'answer'
// A viewer reload or a dropped connection just restarts the handshake.
//
// Browser Supabase client: the board already uses one for realtime; this is the
// same anon key (read-only, from /api/realtime). Broadcast needs no table access.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// STUN by default; /api/realtime adds a TURN relay when one is configured.
let ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export type LiveState = 'connecting' | 'waiting' | 'live' | 'reconnecting' | 'ended' | 'error';

type Signal =
  | { kind: 'viewer-ready'; viewer: string }
  | { kind: 'offer'; viewer: string; session: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; viewer: string; session: string; sdp: RTCSessionDescriptionInit }
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

function gathered(pc: RTCPeerConnection, ms = 5000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    });
  });
}

const dead = (pc: RTCPeerConnection | null) =>
  !pc || ['failed', 'closed', 'disconnected'].includes(pc.connectionState);

/** Viewer (requester / big screen). Returns a stop function. */
export async function startViewer(taskId: string, video: HTMLVideoElement, onState: (s: LiveState) => void) {
  const viewer = crypto.randomUUID();
  let pc: RTCPeerConnection | null = null;
  onState('connecting');

  const ch = await channel(taskId, async s => {
    if (s.kind === 'bye') { onState('ended'); return; }
    if (s.kind !== 'offer' || s.viewer !== viewer) return;
    pc?.close();
    const mine = new RTCPeerConnection({ iceServers: ICE });
    pc = mine;
    mine.ontrack = e => {
      if (video.srcObject !== e.streams[0]) {
        video.srcObject = e.streams[0];
        video.play().catch(() => {});
      }
    };
    mine.onconnectionstatechange = () => {
      if (pc !== mine) return;
      if (mine.connectionState === 'connected') onState('live');
      else if (dead(mine)) onState('reconnecting');
    };
    try {
      await mine.setRemoteDescription(s.sdp);
      await mine.setLocalDescription(await mine.createAnswer());
      await gathered(mine);
      if (pc === mine) ch.send({ kind: 'answer', viewer, session: s.session, sdp: mine.localDescription!.toJSON() });
    } catch {
      onState('reconnecting');
    }
  });

  onState('waiting');
  const ping = () => { if (dead(pc)) ch.send({ kind: 'viewer-ready', viewer }); };
  ping();
  const iv = setInterval(ping, 2000);
  return () => { clearInterval(iv); pc?.close(); ch.close(); };
}

/** Streamer (the picked phone). Call after getUserMedia. Returns a stop function. */
export async function startStreamer(taskId: string, stream: MediaStream, onState: (s: LiveState) => void) {
  let pc: RTCPeerConnection | null = null;
  let session = '';
  let last = { viewer: '', at: 0 };
  onState('connecting');

  const ch = await channel(taskId, async s => {
    if (s.kind === 'viewer-ready') {
      const st = pc?.connectionState;
      if (st === 'connected' || st === 'connecting') return;           // already serving a viewer
      if (last.viewer === s.viewer && Date.now() - last.at < 15000) return; // handshake in flight (two 5s ICE gathers)
      last = { viewer: s.viewer, at: Date.now() };
      pc?.close();
      const mine = new RTCPeerConnection({ iceServers: ICE });
      pc = mine;
      session = crypto.randomUUID();
      const mySession = session;
      stream.getTracks().forEach(t => mine.addTrack(t, stream));
      mine.onconnectionstatechange = () => {
        if (pc !== mine) return;
        if (mine.connectionState === 'connected') onState('live');
        else if (dead(mine)) onState('reconnecting');
      };
      await mine.setLocalDescription(await mine.createOffer());
      await gathered(mine);
      if (pc === mine && session === mySession) {
        ch.send({ kind: 'offer', viewer: s.viewer, session: mySession, sdp: mine.localDescription!.toJSON() });
      }
    } else if (s.kind === 'answer' && pc && s.session === session) {
      await pc.setRemoteDescription(s.sdp).catch(() => onState('reconnecting'));
    }
  });

  onState('waiting');
  return () => { ch.send({ kind: 'bye' }); pc?.close(); ch.close(); };
}
