import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/config';

/**
 * Browser config for realtime + live video. Per CLAUDE.md we don't use
 * NEXT_PUBLIC_ vars, so pages fetch this at runtime instead. The anon key is
 * public by design; RLS on tasks/responses is read-only.
 *
 * iceServers: STUN always. TURN (a relay for networks that block phone-to-laptop
 * video, e.g. venue Wi-Fi) when configured, either:
 *   TURN_URLS=turn:host:80,turns:host:443?transport=tcp  TURN_USERNAME=…  TURN_CREDENTIAL=…
 * or a provider endpoint that returns an iceServers array (e.g. Metered):
 *   TURN_CREDENTIALS_URL=https://<app>.metered.live/api/v1/turn/credentials?apiKey=…
 */
export const dynamic = 'force-dynamic';

const STUN: RTCIceServer = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

async function iceServers(): Promise<RTCIceServer[]> {
  const out: RTCIceServer[] = [STUN];
  const urls = process.env.TURN_URLS;
  if (urls) {
    out.push({
      urls: urls.split(',').map(u => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  const credsUrl = process.env.TURN_CREDENTIALS_URL;
  if (credsUrl) {
    try {
      const r = await fetch(credsUrl, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      const list = await r.json();
      if (Array.isArray(list)) out.push(...(list as RTCIceServer[]));
    } catch (e) {
      console.error('TURN credentials fetch failed', e);
    }
  }
  return out;
}

export async function GET() {
  return Response.json(
    { url: supabaseUrl() ?? null, anonKey: supabaseAnonKey() ?? null, iceServers: await iceServers() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
