import { createClient } from "@supabase/supabase-js";

import { supabaseServiceRoleKey, supabaseUrl } from "./config";

/**
 * Service-role client. Bypasses RLS, so it is only ever constructed inside the
 * Stripe webhook — the one place that legitimately writes to a row on behalf of
 * a user who isn't the one making the request.
 *
 * Never import this into a Client Component. The key must not reach the browser.
 */
export function createAdminClient() {
  const key = supabaseServiceRoleKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createClient(supabaseUrl()!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
