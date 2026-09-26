import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { logSupabaseConfigState } from "@/lib/supabase/config";

// Always render per request. These pages branch on environment variables that
// are resolved at runtime, so letting Next prerender them bakes in whichever
// branch was true at BUILD time — deploy before setting env vars and the page
// says "not configured" forever, even once the values are live. The landing
// page stays static on purpose; it's the one that benefits from being cached.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  if (!isSupabaseConfigured()) {
    // Names, never values — readable in Vercel's Runtime Logs. Turns "it says
    // not configured" into "it found these three names and none of them match".
    logSupabaseConfigState("/login");
    return (
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-20">
        <Link href="/" className="text-sm text-muted hover:text-foreground">
          &larr; Back
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">Not configured yet</h1>
        <p className="mt-3 text-sm text-muted">
          This deployment has no Supabase credentials set, so there is nothing to sign in
          to. See the README for the four environment variables it needs.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const params = await searchParams;
  const message = typeof params.error === "string" ? params.error : null;
  const notice = typeof params.notice === "string" ? params.notice : null;

  async function signIn(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
    redirect("/dashboard");
  }

  async function signUp(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);

    // With email confirmation on, there's no session yet — the user has to click
    // the link first. With it off, they're already signed in.
    if (data.session) redirect("/dashboard");
    redirect(`/login?notice=${encodeURIComponent("Check your email to confirm the account.")}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-20">
      <Link href="/" className="text-sm text-muted hover:text-foreground">
        ← Back
      </Link>

      <h1 className="mt-6 text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-muted">
        New here? Use the same form — Create account makes one.
      </p>

      {message && (
        <p className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      )}
      {notice && (
        <p className="mt-6 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      <form className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-lg border border-border bg-card px-3 py-2.5 outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            className="rounded-lg border border-border bg-card px-3 py-2.5 outline-none focus:border-accent"
          />
        </label>

        <div className="mt-2 flex gap-3">
          <button
            formAction={signIn}
            className="flex-1 rounded-lg bg-accent px-4 py-2.5 font-medium text-white transition hover:opacity-90"
          >
            Sign in
          </button>
          <button
            formAction={signUp}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 font-medium transition hover:border-accent"
          >
            Create account
          </button>
        </div>
      </form>
    </main>
  );
}
