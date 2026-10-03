import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/config';

/**
 * The live board needs a browser Supabase client for realtime. Per CLAUDE.md we
 * don't use NEXT_PUBLIC_ vars, so the board fetches the URL + anon key here at
 * runtime instead. The anon key is public by design; RLS on tasks/responses is
 * read-only, and all writes go through /api/tasks.
 */
export const dynamic = 'force-dynamic';

/**
 * ICE servers for live video. STUN alone fails on cellular and venue Wi-Fi, so a
 * TURN relay is added when configured. Metered (metered.ca) gives static creds:
 *   TURN_USERNAME, TURN_CREDENTIAL  (+ optional TURN_URLS, comma-separated)
 * TURN creds are meant to reach the browser; they only allow relaying traffic.
 */
function iceServers() {
  const servers: { urls: string[]; username?: string; credential?: string }[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  if (username && credential) {
    const urls = (process.env.TURN_URLS ?? [
      'stun:stun.relay.metered.ca:80',
      'turn:global.relay.metered.ca:80',
      'turn:global.relay.metered.ca:80?transport=tcp',
      'turn:global.relay.metered.ca:443',
      'turns:global.relay.metered.ca:443?transport=tcp',
    ].join(',')).split(',').map(u => u.trim()).filter(Boolean);
    servers.push({ urls, username, credential });
  }
  return servers;
}

export async function GET() {
  return Response.json(
    { url: supabaseUrl() ?? null, anonKey: supabaseAnonKey() ?? null, iceServers: iceServers() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
