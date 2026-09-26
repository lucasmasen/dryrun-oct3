import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

/**
 * Keeps the Supabase project from being paused for inactivity.
 *
 * Free-tier Supabase projects are paused after a stretch with no database
 * activity, which would quietly break sign-in for anyone opening the demo link
 * a week after it was shared. Run daily by Vercel Cron (see vercel.json).
 *
 * The query has to actually reach Postgres to count — /api/health doesn't,
 * since it only reads environment variables. This runs under the anon key and
 * row level security, so it reads nothing: with no session, the policy matches
 * no rows. Executing the query is the entire point; the result is discarded.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel Cron sends this header when CRON_SECRET is set. When it isn't set,
  // the endpoint stays open — it exposes no data, but setting the secret stops
  // anyone else from running it.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Supabase isn't configured." }, { status: 500 });
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });

  const { error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("keepalive query failed", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  return NextResponse.json(
    { ok: true, pinged: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
