# delegate-to-human MCP server

Gives any AI agent `delegate_to_human` and `get_human_result` tools. Judgment tasks collect screened human answers and return an aggregate. Action tasks collect verified text or photo proof from a worker, with optional Stripe **TEST** funding. No automatic purchase, worker payout, advance, or reimbursement is performed.

## Quick start
The mock backend, bots, and smoke test below exercise judgment tasks only. Action tasks require the real application backend, its action-task database/storage setup, and Stripe test credentials when funding is nonzero.

```bash
npm install
npm run mock    # fake backend on :4000
npm run bots    # fake humans that answer tasks
npm test        # calls the tool end-to-end
```

## Claude Desktop config
```json
"mcpServers": {
  "delegate-to-human": {
    "command": "node",
    "args": ["/absolute/path/to/server.mjs"],
    "env": { "BASE_URL": "https://your-backend.vercel.app", "TARGET_RESPONSES": "3", "WAIT_SECONDS": "40" }
  }
}
```

See [../API.md](../API.md) for the backend API and [HOST_PROMPT.md](HOST_PROMPT.md) for the demo prompt.

## Tool inputs

`delegate_to_human` keeps its existing judgment defaults: `task_kind: "judgment"`, `response_type: "text"`, and `budget_cents: 500`. Choice judgments also need `options`. Judgment calls still wait for screened responses, close the task, and return the aggregate; `TARGET_RESPONSES` and `WAIT_SECONDS` retain their existing behavior.

For an action, supply:

```json
{
  "task": "Check whether the lobby notice lists today's opening hours.",
  "task_kind": "action",
  "proof_type": "photo",
  "proof_instructions": "Upload a clear photo showing the notice and its opening hours.",
  "purchase_allowance_cents": 0,
  "worker_reward_cents": 500
}
```

`proof_type` (`text` or `photo`) and nonempty `proof_instructions` are required for actions. Allowance and reward are nonnegative integer USD cents, defaulting to zero. Their sum must be zero or at least 50 cents, and cannot exceed 100000 cents. `response_type`, `options`, and `budget_cents` apply only to judgments.

## Action handoff

1. Action creation makes one `POST /api/action-tasks` request and returns immediately. Nonzero funding returns `status: "funding_required"` with the actual backend `checkout_url`. Zero-cost tasks return `status: "pending"` with `worker_url`. Both include `task_id`, `task_kind`, `task_status`, and the worker link.
2. Claude must **present the checkout link to the user**, not claim to have opened it or paid automatically. The user completes Stripe test checkout themselves (test card `4242 4242 4242 4242`). Test funding does not pay or reimburse the worker.
3. Present the worker link so a human can claim the action and submit the requested proof. After funding, explicitly call:

   ```json
   {
     "task_id": "<returned task_id>",
     "task_kind": "action"
   }
   ```

   using `get_human_result`. Omitting `task_kind` selects the existing judgment flow.
4. Action lookup uses only `GET /api/action-tasks/<encoded-id>`. It returns funding instructions immediately while awaiting funding; otherwise it polls until `completed` or the wait expires. The wait is capped at 40 seconds (`WAIT_SECONDS` can shorten it), with bounded individual requests. No vote threshold or task-close request is used.
5. Completed output contains the backend `summary`, `proof_text`, and `photo_url`. Otherwise output remains `pending` or `funding_required` with links and instructions; call `get_human_result` again as needed. Photo URLs are signed and expire.

Action requests preserve HTTP status and backend error text in MCP errors. Action creation is **never automatically retried**, including network failures, timeouts, or malformed success responses: the task may already exist even if its response was lost. Resolve an ambiguous delivery before issuing another create request; do not blindly resend.
