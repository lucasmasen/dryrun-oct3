import Link from "next/link";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export default async function Home() {
  // Public page: renders on a fresh deploy with no env vars set, so a missing
  // Supabase is just "signed out" here rather than a 500.
  let user = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    ({
      data: { user },
    } = await supabase.auth.getUser());
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-20">
      <p className="text-sm font-medium uppercase tracking-wide text-accent">
        Hackathon Starter
      </p>

      <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">
        Replace this headline with your idea.
      </h1>

      <p className="mt-6 text-lg leading-relaxed text-muted">
        Auth, Postgres with row level security, a structured Claude call, Stripe checkout and
        a deploy pipeline are already wired up and tested. Edit{" "}
        <code className="font-mono text-base">src/app/api/generate/route.ts</code> and this
        page, and you have a working product.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Link
          href={user ? "/dashboard" : "/login"}
          className="rounded-lg bg-accent px-5 py-3 font-medium text-white transition hover:opacity-90"
        >
          {user ? "Open dashboard" : "Start free"}
        </Link>
        <span className="text-sm text-muted">5 free runs a month.</span>
      </div>
    </main>
  );
}
