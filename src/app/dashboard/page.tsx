import { redirect } from "next/navigation";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getUsage } from "@/lib/plan";
import type { Item } from "@/lib/types";

import ItemForm from "./item-form";
import ItemList from "./item-list";
import UpgradeButton from "./upgrade-button";

// Always render per request. These pages branch on environment variables that
// are resolved at runtime, so letting Next prerender them bakes in whichever
// branch was true at BUILD time — deploy before setting env vars and the page
// says "not configured" forever, even once the values are live. The landing
// page stays static on purpose; it's the one that benefits from being cached.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!isSupabaseConfigured()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [usage, { data: items }] = await Promise.all([
    getUsage(supabase, user.id),
    supabase
      .from("items")
      .select("id, title, input, output, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">{user.email}</p>
        </div>
        <form action={signOut}>
          <button className="text-sm text-muted transition hover:text-foreground">
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
        <p className="text-sm">
          {usage.plan === "pro" ? (
            <>
              <span className="font-medium">Pro</span>
              <span className="text-muted"> · unlimited</span>
            </>
          ) : (
            <>
              <span className="font-medium">
                {usage.remaining} of {usage.limit} runs left
              </span>
              <span className="text-muted"> this month</span>
            </>
          )}
        </p>
        {usage.plan === "free" && <UpgradeButton />}
      </section>

      <ItemForm outOfRuns={usage.remaining === 0} />
      <ItemList items={(items ?? []) as Item[]} />
    </main>
  );
}
