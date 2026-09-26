import type { SupabaseClient } from "@supabase/supabase-js";

export const FREE_MONTHLY_LIMIT = 5;

export type Usage = {
  plan: "free" | "pro";
  used: number;
  limit: number | null; // null means unlimited
  remaining: number | null;
};

function startOfMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * How many runs this user has left this calendar month.
 *
 * Counted from the items rows themselves rather than a counter column —
 * a counter can drift out of sync with reality, and at this volume the count
 * query is free. Both reads run under RLS, so they can only see their own rows.
 */
export async function getUsage(supabase: SupabaseClient, userId: string): Promise<Usage> {
  const [{ data: profile }, { count }] = await Promise.all([
    supabase.from("profiles").select("plan").eq("id", userId).single(),
    supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", startOfMonthISO()),
  ]);

  const plan = profile?.plan === "pro" ? "pro" : "free";
  const used = count ?? 0;

  if (plan === "pro") {
    return { plan, used, limit: null, remaining: null };
  }
  return {
    plan,
    used,
    limit: FREE_MONTHLY_LIMIT,
    remaining: Math.max(0, FREE_MONTHLY_LIMIT - used),
  };
}
