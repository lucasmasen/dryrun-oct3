import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/config';

/**
 * The live board needs a browser Supabase client for realtime. Per CLAUDE.md we
 * don't use NEXT_PUBLIC_ vars, so the board fetches the URL + anon key here at
 * runtime instead. The anon key is public by design; RLS on tasks/responses is
 * read-only, and all writes go through /api/tasks.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { url: supabaseUrl() ?? null, anonKey: supabaseAnonKey() ?? null },
    { headers: { 'cache-control': 'no-store' } },
  );
}
