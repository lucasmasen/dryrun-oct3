import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

/**
 * Next 16 renamed Middleware to Proxy — same mechanism, new filename and export.
 *
 * This runs on every matched request to refresh the Supabase session cookie.
 * Without it, an expired access token never gets rotated and the user is
 * silently logged out mid-session.
 *
 * It's deliberately not doing authorization. Every page and route checks the
 * session itself, and RLS is the real boundary; a proxy-only check would be a
 * single point of failure.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Nothing to refresh before the project is wired up. Without this, every
  // request on a freshly deployed instance throws before reaching a page.
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touching the user is what triggers the refresh. Don't remove it.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the Stripe webhook, which carries no
    // session cookie and whose raw body must not be touched.
    "/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
