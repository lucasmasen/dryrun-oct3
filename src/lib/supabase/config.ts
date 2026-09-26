/**
 * Resolves Supabase credentials at RUNTIME rather than build time.
 *
 * Why this exists instead of reading process.env.NEXT_PUBLIC_SUPABASE_URL directly:
 *
 * 1. Next.js inlines a static `process.env.NEXT_PUBLIC_FOO` into the compiled
 *    output at build time. Vercel's "Sensitive" environment variables are
 *    deliberately unavailable during the build, so a sensitive NEXT_PUBLIC_ var
 *    compiles to undefined and stays undefined forever — even though the value
 *    is sitting right there at runtime.
 * 2. Hosting integrations don't agree on names. The Supabase integration has
 *    shipped SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, and prefixed variants
 *    depending on version, and anon keys now sometimes arrive as
 *    PUBLISHABLE_KEY.
 *
 * Indexing process.env with a variable (rather than a literal property access)
 * is what keeps the bundler from inlining it, so these are real runtime reads.
 * Every consumer of this module is server-side — there is no browser Supabase
 * client in this app — so runtime resolution is safe here.
 */

function readEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

const URL_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_NEXT_PUBLIC_SUPABASE_URL",
] as const;

const ANON_NAMES = [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const SERVICE_ROLE_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function supabaseUrl(): string | undefined {
  return readEnv(URL_NAMES);
}

export function supabaseAnonKey(): string | undefined {
  return readEnv(ANON_NAMES);
}

export function supabaseServiceRoleKey(): string | undefined {
  return readEnv(SERVICE_ROLE_NAMES);
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

/**
 * Logs which candidate names were actually found, values never included.
 * Shows up in Vercel's Runtime Logs and is the fastest way to see whether a
 * misconfiguration is a missing value or an unexpected variable name.
 */
export function logSupabaseConfigState(context: string): void {
  const found = [...URL_NAMES, ...ANON_NAMES, ...SERVICE_ROLE_NAMES].filter(
    (name) => process.env[name],
  );
  console.error(
    `[supabase config] ${context}: no usable credentials. Recognized names present: ${
      found.length ? found.join(", ") : "(none)"
    }`,
  );
}
