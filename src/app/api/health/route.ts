import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Deployment visibility, without exposing anything sensitive.
 *
 * Diagnosing "the site says it isn't configured" through a CDN is guesswork:
 * a cached page from an older build is indistinguishable from a new build that
 * genuinely can't see its credentials. This route is never cached and reports
 * which commit is serving and whether that build can resolve its config — so
 * the two cases can be told apart from outside.
 *
 * Booleans and a commit SHA only. No values, no variable names.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      supabaseConfigured: isSupabaseConfigured(),
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      stripeConfigured: Boolean(
        process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID,
      ),
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
