# Hackathon Starter

Auth, Postgres with row level security, a structured Claude call, Stripe checkout, and a
deploy pipeline — already wired together and tested end to end. Built so that on the day,
the first hour goes into the idea instead of into `create-next-app` and environment variables.

## The 15-minute setup

1. **Create the repo** from this template, clone it, `npm install`.
2. **Supabase** → new project → SQL Editor → paste `supabase/schema.sql` → Run.
   Then Authentication → Sign In / Providers → turn **off** "Confirm email", so judges and
   teammates can sign in without hunting for a confirmation link.
3. **Vercel** → import the repo → add the environment variables below → deploy.
4. Open `/api/health` and confirm `supabaseConfigured` and `anthropicConfigured` are `true`.

```
SUPABASE_URL                 https://<ref>.supabase.co   (no path, no trailing slash)
SUPABASE_ANON_KEY            the publishable key (sb_publishable_…)
SUPABASE_SERVICE_ROLE_KEY    the secret key (sb_secret_…)
ANTHROPIC_API_KEY            sk-ant-…
```

**Do not prefix any of these with `NEXT_PUBLIC_`.** See "The trap" below.

Stripe is optional. Without `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` the app reports
"Stripe isn't configured" instead of breaking.

## Deploy in the first hour, not the last

Deploy this before you've written a line of your own code. A deploy problem discovered at
9:30am costs you twenty minutes; the same problem at 4:30pm costs you the demo. Every deploy
after the first is then a small diff against something known to work.

`GET /api/health` returns the serving commit and whether each integration resolves, uncached.
When something looks broken, check it before theorizing — a CDN-cached page from an old build
looks exactly like a new build that can't see its credentials.

## Making it your idea

Three things, in one file: **`src/app/api/generate/route.ts`**

1. `OutputSchema` — the shape you want back. The `.describe()` calls are read by the model,
   so they're the cheapest quality lever you have.
2. `SYSTEM` — the rules. Be specific about what it must *not* do; that's usually what
   separates a demo that lands from one that embarrasses you on stage.
3. The user message.

Then keep these in sync, or the UI will silently render nothing:
- `src/lib/types.ts` — same shape as `OutputSchema`
- `src/app/dashboard/item-list.tsx` — renders that shape
- `supabase/schema.sql` — rename `items`, add columns. `output` is `jsonb`, so you can
  change what you generate without a migration. That matters when you pivot at 2pm.

Everything else is infrastructure and shouldn't need touching. **If a pivot requires editing
auth or the deploy config, it's the wrong pivot.**

## What's already handled

| | Where |
|---|---|
| Email + password auth, session refresh, protected routes | `src/lib/supabase/`, `src/proxy.ts` |
| RLS policies keyed on `auth.uid()`, insert guarded by `with check` | `supabase/schema.sql` |
| Structured Claude call, typed with Zod | `src/app/api/generate/route.ts` |
| Free/pro quota, enforced server-side before the model call | `src/lib/plan.ts` |
| Stripe checkout + signature-verified webhook | `src/app/api/checkout/`, `src/app/api/stripe/` |
| Deployment visibility | `src/app/api/health/route.ts` |
| Daily cron so free-tier Supabase doesn't pause | `vercel.json`, `src/app/api/keepalive/` |
| Renders fine with no env vars set at all | `src/lib/supabase/config.ts` |

## The trap

Vercel withholds **Secret**-type environment variables during the build. Next.js inlines
`process.env.NEXT_PUBLIC_*` at build time. So a `NEXT_PUBLIC_` variable marked Secret
compiles to `undefined` permanently — even though the value is right there at runtime — and
Vercel refuses to save that combination anyway.

Nothing here needs Supabase in the browser, so `src/lib/supabase/config.ts` reads the
environment at runtime by indexing `process.env` with a variable, which the bundler can't
inline. Keep it that way and don't add `NEXT_PUBLIC_` variables.

## Demo notes

Judges watch two or three minutes. Build the demo path first, make it flawless, and add
features only if they sit on that path. A narrow thing that works beats a broad thing that
half-works — and breadth is the direction coding agents will push you, because generating
more features is the easy part.

Commit every working state and branch per idea. When an idea dies at 1pm you want to be back
to something that runs in three seconds.

## Human inference frontend

- `/t/<task-id>`: anonymous text or choice fulfillment. Sends only the answer through the existing API; photo responses are unsupported.
- `/board/<task-id>`: read-only agent workspace showing actual task status, all submissions, screening outcomes, and the backend result. The host still creates and closes tasks.
- `/board/demo`: enter a request to start an explicitly labeled deterministic pitch-hook simulation on the same canvas. Open `/t/demo` in another tab on the same browser/origin to add one response. Append `?type=text` to both routes for the text fixture.
- Replay resets the local demo. Demo state uses versioned localStorage, so it is not cross-device synchronization and never calls the backend or a planner.

Real results show reported payout only. A recorded Stripe PaymentIntent does not prove settlement; the workspace never claims capture, refund, or host-agent acknowledgment.

Orb, arrival-beam, and decorative signal-merge effects respect reduced motion and visibility. Submit/result silver framing uses native static styling: MetalFx was removed after WebKit runtime testing showed hidden controls.

Run `node scripts/frontend-check.mjs`, `npm run lint`, `npm run build`, and `npx tsc --noEmit` for frontend checks. Existing teammate `/do` and `/board` routes remain unchanged.
