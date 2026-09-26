import { NextResponse } from "next/server";
import Stripe from "stripe";

import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return NextResponse.json({ error: "Stripe isn't configured." }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = new URL(request.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/billing/success`,
    cancel_url: `${origin}/dashboard`,
    customer_email: user.email,
    // The webhook needs to know which user paid, and it can't read the session
    // cookie. This is the link between a Stripe customer and a Supabase user.
    client_reference_id: user.id,
    metadata: { supabase_user_id: user.id },
    subscription_data: { metadata: { supabase_user_id: user.id } },
  });

  return NextResponse.json({ url: session.url });
}
