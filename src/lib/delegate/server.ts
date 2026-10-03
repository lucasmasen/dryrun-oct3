import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * delegate_to_human backend helpers. Server-only.
 *
 * Clients are created lazily on first use, not at import time: Vercel withholds
 * Secret env vars during the build, so constructing them at module load would
 * crash `next build`. Config is resolved at runtime via src/lib/supabase/config.ts
 * (no NEXT_PUBLIC_ vars — see CLAUDE.md).
 *
 * The service-role client is used because there is no auth in this flow: the
 * agent, phones and bots are anonymous, and every write goes through these routes.
 */

let _db: SupabaseClient | null = null;
function admin(): SupabaseClient {
  return (_db ??= createAdminClient());
}
export const db = { from: (table: string) => admin().from(table) };

let _stripe: Stripe | null = null;
function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return (_stripe ??= new Stripe(key));
}

// Escrow = manual-capture PaymentIntent on a test card. Shows up in the dashboard immediately.
export async function holdEscrow(amountCents: number, taskId: string): Promise<string | null> {
  const s = stripe();
  if (!s) return null;
  const pi = await s.paymentIntents.create({
    amount: Math.max(amountCents, 50),
    currency: 'usd',
    capture_method: 'manual',
    payment_method: 'pm_card_visa',
    payment_method_types: ['card'],
    confirm: true,
    description: `delegate_to_human escrow ${taskId}`,
    metadata: { task_id: taskId },
  });
  return pi.id;
}

export async function releaseEscrow(piId: string, captureCents?: number) {
  const s = stripe();
  if (!s) return null;
  return s.paymentIntents.capture(piId, captureCents ? { amount_to_capture: captureCents } : {});
}

export async function refundEscrow(piId: string) {
  const s = stripe();
  if (!s) return null;
  return s.paymentIntents.cancel(piId);
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Access-Control-Allow-Origin': '*', 'cache-control': 'no-store' },
  });
}
