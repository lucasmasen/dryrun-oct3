import 'server-only';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

function testStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || (!key.startsWith('sk_test_') && !key.startsWith('rk_test_'))) {
    throw new Error('Stripe test-mode funding is not configured. Live payments are disabled.');
  }
  return new Stripe(key);
}

function checkoutOrigin(origin: string) {
  const url = new URL(process.env.APP_URL || origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Checkout requires an HTTPS app URL.');
  }
  return url.origin;
}

export async function createActionCheckout(
  taskId: string,
  input: { prompt: string; total_cents: number },
  origin: string,
): Promise<{ session_id: string; url: string }> {
  if (!Number.isSafeInteger(input.total_cents) || input.total_cents < 50 || input.total_cents > 100_000) {
    throw new Error('Test funding total must be between $0.50 and $1,000.');
  }
  const stripe = testStripe();
  const base = checkoutOrigin(origin);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: input.total_cents,
        product_data: { name: 'Human task — test funding', description: input.prompt.slice(0, 500) },
      },
      quantity: 1,
    }],
    payment_intent_data: { capture_method: 'manual', metadata: { action_task_id: taskId } },
    metadata: { action_task_id: taskId },
    success_url: `${base}/funding/${encodeURIComponent(taskId)}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/funding/${encodeURIComponent(taskId)}?canceled=1`,
  }, { idempotencyKey: `action-checkout:${taskId}` });
  if (session.livemode || !session.url) throw new Error('A test checkout could not be created.');
  const { data, error } = await createAdminClient().from('action_tasks').update({
    checkout_session_id: session.id, checkout_url: session.url,
  }).eq('id', taskId).eq('status', 'awaiting_funding').eq('funding_status', 'unfunded')
    .select('id').maybeSingle();
  if (error || !data) {
    await stripe.checkout.sessions.expire(session.id);
    throw new Error('Test checkout could not be saved; checkout has been canceled.');
  }
  return { session_id: session.id, url: session.url };
}

async function fundingRow(taskId: string) {
  const db = createAdminClient();
  const { data, error } = await db.from('action_tasks')
    .select('id,total_cents,status,proof_status,checkout_session_id,payment_intent_id,funding_status')
    .eq('id', taskId).maybeSingle();
  if (error) throw new Error('Task funding could not be read.');
  if (!data) throw new Error('Task not found.');
  return { db, row: data };
}

function validateIntent(intent: Stripe.PaymentIntent, taskId: string, total: number) {
  if (intent.livemode || intent.currency !== 'usd' || intent.amount !== total || intent.metadata.action_task_id !== taskId || intent.capture_method !== 'manual') {
    throw new Error('Stripe funding does not match this test task.');
  }
}

export async function syncActionFunding(taskId: string): Promise<void> {
  const { db, row } = await fundingRow(taskId);
  if (!row.total_cents || !row.checkout_session_id || row.funding_status === 'captured') return;
  const stripe = testStripe();
  const session = await stripe.checkout.sessions.retrieve(row.checkout_session_id, { expand: ['payment_intent'] });
  if (session.livemode || session.metadata?.action_task_id !== taskId || session.currency !== 'usd' || session.amount_total !== row.total_cents) {
    throw new Error('Stripe checkout does not match this test task.');
  }
  if (session.status !== 'complete' || !session.payment_intent) return;
  const intent = typeof session.payment_intent === 'string'
    ? await stripe.paymentIntents.retrieve(session.payment_intent)
    : session.payment_intent;
  validateIntent(intent, taskId, row.total_cents);
  const held = intent.status === 'requires_capture' && intent.amount_capturable === row.total_cents;
  const captured = intent.status === 'succeeded' && intent.amount_received === row.total_cents;
  if (!held && !captured) return;
  const { error } = await db.from('action_tasks').update({
    funding_status: captured ? 'captured' : 'held',
    payment_intent_id: intent.id,
    ...(row.status === 'awaiting_funding' ? { status: 'open' } : {}),
  }).eq('id', taskId).eq('funding_status', row.funding_status).eq('status', row.status);
  if (error) throw new Error('Confirmed funding could not be saved.');
}

export async function captureActionFunding(taskId: string): Promise<void> {
  const { db, row } = await fundingRow(taskId);
  if (row.status !== 'verifying' || row.proof_status !== 'accepted') {
    throw new Error('Accepted proof must be recorded before test funds are captured.');
  }
  if (!row.total_cents) return;
  if (!row.payment_intent_id || !['held', 'captured'].includes(row.funding_status)) {
    throw new Error('Test funds have not been authorized.');
  }
  const stripe = testStripe();
  let intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
  validateIntent(intent, taskId, row.total_cents);
  if (intent.status === 'requires_capture' && intent.amount_capturable === row.total_cents) {
    intent = await stripe.paymentIntents.capture(intent.id, { amount_to_capture: row.total_cents }, { idempotencyKey: `action-capture:${taskId}` });
  }
  if (intent.status !== 'succeeded' || intent.amount_received !== row.total_cents) {
    throw new Error('Stripe test capture has not completed.');
  }
  const { error } = await db.from('action_tasks').update({ funding_status: 'captured' }).eq('id', taskId).eq('payment_intent_id', intent.id);
  if (error) throw new Error('Stripe captured test funds, but task confirmation could not be saved. Retry confirmation; funds will not be captured twice.');
}
