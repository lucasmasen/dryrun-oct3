import { NextResponse } from "next/server";
import Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The only route that writes another user's row, and the only one that uses the
 * service-role key. It is safe to do that here precisely because the signature
 * check below proves the request came from Stripe — an unsigned or replayed body
 * is rejected before any database call.
 *
 * Excluded from proxy.ts's matcher: it carries no session cookie, and the raw
 * body has to reach constructEvent byte for byte.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!process.env.STRIPE_SECRET_KEY || !secret) {
    return NextResponse.json({ error: "Stripe isn't configured." }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch (error) {
    // Bad signature. Could be a misconfigured secret, could be someone poking
    // the endpoint — either way it never reaches the database.
    console.error("webhook signature check failed", error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const supabase = createAdminClient();

  async function setPlan(userId: string | null | undefined, plan: "free" | "pro") {
    if (!userId) {
      console.error(`${event.type}: no supabase user id on the event`);
      return;
    }
    const { error } = await supabase.from("profiles").update({ plan }).eq("id", userId);
    if (error) console.error(`failed to set plan=${plan} for ${userId}`, error);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      await setPlan(session.client_reference_id ?? session.metadata?.supabase_user_id, "pro");
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      await setPlan(subscription.metadata?.supabase_user_id, "free");
      break;
    }
    default:
      // Every other event type is acknowledged and ignored, so Stripe doesn't
      // retry things this app doesn't care about.
      break;
  }

  return NextResponse.json({ received: true });
}
