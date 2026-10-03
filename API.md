# delegate_to_human — API Spec

Backend contract for the agent (MCP), the phone page, the board, and the test bots.
**Change only by announcing it in team chat.** Types live in `lib/types.ts`.

- Base URL: `https://<our-app>.vercel.app`. Phones can't hit localhost, so always test on the deployed URL.
- All bodies are JSON. CORS is open (`*`).
- No auth.

---

## Endpoints at a glance

| # | Method | Path | Who calls it |
|---|--------|------|--------------|
| 1 | `POST` | `/api/tasks` | Agent / MCP: create a task and hold escrow |
| 2 | `GET`  | `/api/tasks/:id` | Agent: poll every 1.5s |
| 3 | `POST` | `/api/tasks/:id/responses` | Phone page: submit an answer |
| 4 | `POST` | `/api/tasks/:id/close` | Agent: after 3 responses or 40s |
| – | `GET`  | `/api/tasks` | Test bots, phone page: list tasks |
| – | `GET`  | `/api/tasks/:id/responses` | Debug: list responses for a task |

---

## 1. Create task

`POST /api/tasks`

```json
{
  "prompt": "Which brunch spot for 4?",
  "response_type": "choice",
  "options": ["Zazie", "Plow"],
  "budget_cents": 500
}
```

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `prompt` | string | yes | | What the humans see |
| `response_type` | `"text"` \| `"choice"` \| `"photo"` | yes | | |
| `options` | string[] | for `choice` | `null` | |
| `budget_cents` | int | no | `500` | Held in Stripe escrow (minimum 50) |
| `min_responses` | int | no | `3` | |
| `ttl_seconds` | int | no | `180` | |

**→ 201**
```json
{ "id": "abc123", "status": "open", "payment_intent_id": "pi_xxx" }
```

Escrow is a Stripe test-mode PaymentIntent with manual capture, so it appears in the dashboard right away. If Stripe fails, the task is still created with `payment_intent_id: null`.

---

## 2. Get task

`GET /api/tasks/:id`

**→ 200** while open:
```json
{
  "id": "abc123",
  "prompt": "Which brunch spot for 4?",
  "response_type": "choice",
  "options": ["Zazie", "Plow"],
  "status": "open",
  "responses_count": 2,
  "budget_cents": 500,
  "created_at": "2026-10-03T21:00:00Z"
}
```

`status` is one of `open`, `closing` or `closed`. Once it's `closed`, the same object also includes `"result": { ... }`, in the shape shown in #4.

`responses_count` counts **all** submissions, including rejected ones.

---

## 3. Submit response

`POST /api/tasks/:id/responses`

```json
{ "answer": "Zazie", "name": "Maya" }
```

- For `choice` tasks, `answer` must match one of the options. The match is case-insensitive, and the answer is stored as the exact option string. **Send the option text, not its index.**
- `name` is optional and defaults to `"anon"`.

**→ 201**
```json
{ "ok": true, "id": "resp_id", "accepted": true, "reason": "valid option" }
```

**Errors:** `400` means `answer` is missing, `404` means the task wasn't found, and `409` means the task is already closed. All of them return `{ "ok": false, "error": "..." }`.

**Screening** runs at submit time and can take up to about 5s:
1. Choice answers are checked against the options.
2. Text answers are rejected if they're shorter than 3 characters or match a prompt-injection pattern.
3. Text answers then go through a Claude Haiku screen for coherence, staying on topic, and injection attempts. If Claude times out or errors, the answer is accepted.

The row is inserted as `pending` **before** screening, so it appears on the board immediately and then flips to `accepted` or `rejected`.

---

## 4. Close

`POST /api/tasks/:id/close`

Aggregates the accepted answers, pays out, and returns the data to the agent. It responds in **under 10s**: about 1s for choice tasks, and about 5s at most for text tasks.

**→ 200**
```json
{
  "id": "abc123",
  "status": "closed",
  "result": {
    "summary": "3 verified humans answered. Most common answer: Zazie (2/3)",
    "winner": "Zazie",
    "tally": { "Zazie": 2, "Plow": 1 },
    "responses": [
      { "answer": "Zazie", "name": "Maya" },
      { "answer": "Zazie", "name": "Raj" },
      { "answer": "Plow",  "name": "Ana" }
    ],
    "rejected": 1,
    "paid": { "total_cents": 498, "per_human_cents": 166, "stripe": "pi_xxx" }
  }
}
```

- `responses` contains **accepted** answers only.
- `tally` is included for choice tasks only. For text tasks, `winner` is Claude's consolidated answer.
- Payment works like this: `per_human_cents` is `budget_cents` divided by the number of accepted answers, rounded down, and the total is captured from escrow. If nothing was accepted, the escrow is cancelled and refunded.
- Close is **idempotent**: calling it twice returns the same result and never captures the payment twice.
- Any answer still being screened when close is called is decided by the instant checks only, so close never waits on the AI.

---

## List tasks

`GET /api/tasks` (add `?status=open` to filter)

**→ 200**: an array of task objects in the same shape as #2, newest first, at most 20.

The phone page can use `GET /api/tasks?status=open` and take `[0]` to find the current task when the URL has no id.

---

## Realtime (board)

The board subscribes to Supabase realtime with the **anon key**, which only has read access; every write goes through the API.

This repo has **no `NEXT_PUBLIC_` vars** (see `CLAUDE.md`), so the board gets its config at runtime:

`GET /api/realtime` returns `{ "url": "...", "anonKey": "..." }`

| Table | Board cares about |
|-------|-------------------|
| `responses` | `INSERT` (new answer, `pending`) and `UPDATE` (`status` changes to `accepted`/`rejected`, `screen_reason`, `payout_cents`) |
| `tasks` | `UPDATE` (`status` changes to `closed`, `result` filled) |

The DB column names differ from the API field names:

| API | DB column |
|-----|-----------|
| `answer` | `responses.content` |
| `name` | `responses.worker_name` |

```ts
import { createClient } from '@supabase/supabase-js';
const { url, anonKey } = await fetch('/api/realtime').then(r => r.json());
const supabase = createClient(url, anonKey);

supabase.channel('board')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'responses', filter: `task_id=eq.${taskId}` }, onResponse)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${taskId}` }, onTask)
  .subscribe();
```

The demo tip: show rejected responses crossed out with their `screen_reason`, because that makes the injection catch visible.

---

## Agent flow (reference)

```
POST /api/tasks                      → id
loop every 1.5s, max 40s:
  GET /api/tasks/:id
  if responses_count >= 3: break
POST /api/tasks/:id/close            → result
agent continues using result.winner / result.summary
```

---

## Env vars (Vercel)

These are already in `.env.example`. Do **not** use a `NEXT_PUBLIC_` prefix.

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # server only
STRIPE_SECRET_KEY=sk_test_...      # test mode only; without it, tasks still work with no escrow
ANTHROPIC_API_KEY=                 # optional; screening falls back to mechanical rules
```

`GET /api/health` shows whether each integration resolves on the deployed build.

## Database

Run `supabase/schema.sql` in the Supabase SQL editor. It's safe to re-run. The `tasks` and `responses` tables are at the bottom of the file.

## Code layout

| Path | What |
|------|------|
| `src/lib/delegate/types.ts` | The contract types |
| `src/lib/delegate/server.ts` | Supabase admin + Stripe escrow helpers |
| `src/lib/delegate/screen.ts` | Screening (mechanical + Claude Haiku) and aggregation |
| `src/lib/delegate/close.ts` | Close: aggregate, pay, store result |
| `src/app/api/tasks/**` | Endpoints #1 to #4 |
| `src/app/api/realtime/route.ts` | Realtime config for the board |

Screening and aggregation use `claude-haiku-4-5` rather than the repo's default model because close has to answer in under 10s.

## Smoke test

```bash
BASE=https://<our-app>.vercel.app bash scripts/smoke.sh
```

It runs create, 4 submits (one of them an injection attempt), get, a timed close, and a final get. The expected result is Zazie as the winner at 2/3, 1 rejected, and $4.98 captured in the Stripe test dashboard.

## Single-worker action tasks (Stripe test demo)

Action tasks use `/api/action-tasks`, separate from judgment/voting tasks above.
Apply `supabase/action-tasks.sql` to an existing database before using these routes.
New database setup also includes these definitions in `supabase/schema.sql`.

- `POST /api/action-tasks`: `{ "prompt": "...", "proof_type": "text" | "photo", "proof_instructions": "...", "purchase_allowance_cents": 0, "worker_reward_cents": 0 }`.
- `GET /api/action-tasks`: list action tasks. `GET /api/action-tasks/:id`: current task, funding, proof, result.
- `POST /api/action-tasks/:id/claim`: `{ "device_id": "..." }`; returns a private `claim_token` and task. Save the token locally; it is required for proof submission.
- `POST /api/action-tasks/:id/proof`: multipart form with `claim_token` and either `text` or `photo`, matching the task's proof modality.

Nonzero allowance + reward requires hosted Stripe Checkout authorization before
workers can claim. Only Stripe test keys are accepted; use `4242 4242 4242 4242`
with a future expiry and any three-digit CVC. Funding confirmation retrieves the
stored Checkout session from Stripe; a browser redirect alone never funds a task.
Accepted proof captures the authorized test amount and completes the task.
This does not buy an item, advance money, reimburse a worker, or transfer a payout.

Proof verification requires `ANTHROPIC_API_KEY`; missing configuration, malformed
output, and provider errors never count as accepted proof. Photos are limited to
4 MB JPEG/PNG/WebP and stored in the private `action-proofs` bucket. The anonymous
demo API exposes task/evidence views with expiring photo links; do not submit
sensitive evidence. Device IDs and hashed claim credentials stay private.

Worker surface: `/do`. Task monitoring: `/board`. Requester return: `/funding/:id`.
MCP action calls must set `task_kind: "action"`; after funding, call
`get_human_result` with the returned `task_id` and `task_kind: "action"`.
