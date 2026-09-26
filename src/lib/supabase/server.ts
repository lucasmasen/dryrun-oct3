import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { supabaseAnonKey, supabaseUrl } from "./config";

export { isSupabaseConfigured } from "./config";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * cookies() is async in Next 16, so this is too — await it at every call site.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    supabaseUrl()!,
    supabaseAnonKey()!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies. Harmless here: proxy.ts
            // refreshes the session on every request, so the write it's
            // rejecting has already happened there.
          }
        },
      },
    },
  );
}
