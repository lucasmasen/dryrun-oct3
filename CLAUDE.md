@AGENTS.md

# Stack rules for this project

Read these before changing anything. They are all things that were learned the
hard way; re-deriving them costs hours.

## Where the idea lives

`src/app/api/generate/route.ts` is the only file that encodes what this product
does. Its Zod `OutputSchema`, the `SYSTEM` prompt, `src/lib/types.ts`, and the
rendering in `src/app/dashboard/item-list.tsx` all describe the same shape —
change them together or the UI silently renders nothing.

Everything else (auth, session refresh, RLS, quota, Stripe, deploy) is
infrastructure. Pivots should not need to touch it. If a change requires editing
auth or the deploy config, stop and reconsider the change.

## Claude API

- Model is `claude-opus-5`. Do not swap it for a smaller model to save money
  without being asked.
- Structured output uses `client.messages.parse()` with `zodOutputFormat`, not
  prose parsing. `parsed_output` can be null — always guard it.
- `thinking: { type: "adaptive" }` with `output_config.effort` set. Do not use
  `budget_tokens`; it returns a 400 on this model. Do not disable thinking —
  lower the effort instead.

## Environment variables — the trap

Vercel withholds **Secret**-type environment variables during the build, and
Next.js inlines `process.env.NEXT_PUBLIC_*` at build time. A `NEXT_PUBLIC_`
variable marked Secret therefore compiles to `undefined` forever even though the
value exists at runtime, and Vercel now refuses to save that combination at all.

So: **no `NEXT_PUBLIC_` variables in this project.** `src/lib/supabase/config.ts`
resolves config at runtime by indexing `process.env` with a variable, which the
bundler cannot inline, and accepts several naming conventions. Nothing here needs
Supabase in the browser — every read is server-side. Do not add a browser
Supabase client without a concrete reason.

## Debugging a deployment

Do not infer deployment state from rendered pages — a CDN-cached page from an
older build is indistinguishable from a new build that cannot see its config.
`GET /api/health` reports the serving commit and whether each integration
resolves, uncached. Check it first. `x-vercel-cache: HIT` with a climbing `age`
header means you are reading a cache, not the app.

## Database

Every table needs RLS enabled and policies keyed on `auth.uid()`, including
`with check` on insert. The anon key is public by design; the policies are the
actual security boundary. `supabase/schema.sql` is the source of truth — edit it
there, not only in the dashboard.

## Next.js 16

Middleware is called **Proxy** now: `src/proxy.ts`, exporting `proxy`. `cookies()`
is async. Read the bundled docs in `node_modules/next/dist/docs/` rather than
relying on memory of older versions.
