#!/usr/bin/env node
// MCP server: gives any AI agent a `delegate_to_human` tool.
// IMPORTANT: never console.log here — stdout is the MCP channel. Use log() (stderr).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const TARGET_RESPONSES = Number(process.env.TARGET_RESPONSES || 3); // close once this many humans answered
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS || 40); // stay under client tool timeout (~60s)
const POLL_MS = 1500;

const log = (...a) => console.error("[delegate]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE_URL + path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      if (res.status >= 500 && attempt < 2) { log(method, path, res.status, "retrying"); await sleep(500); continue; }
      if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : {};
    } catch (e) {
      if (attempt === 2) throw e;
      log(method, path, "error", e.message, "retrying");
      await sleep(500);
    }
  }
}

// Action creation is never retried: a lost response can still mean a task was created.
async function actionApi(method, path, body, timeoutMs = 15000) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return actionTaskSchema.parse(JSON.parse(text));
}

const actionTaskSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["awaiting_funding", "open", "claimed", "verifying", "completed"]),
  result: z.object({
    summary: z.string(),
    proof_text: z.string().nullable(),
    photo_url: z.string().nullable(),
  }).nullable(),
  funding: z.object({
    status: z.enum(["unfunded", "held", "captured"]),
    checkout_url: z.string().url().nullable(),
  }).nullable(),
});

function actionOutput(task) {
  const id = encodeURIComponent(task.id);
  const common = {
    task_kind: "action", task_id: task.id, task_status: task.status,
    worker_url: `${BASE_URL}/do?task=${id}`,
  };
  if (task.status === "completed") {
    if (!task.result) throw new Error(`Action task ${task.id} is completed but its result is unavailable.`);
    return { status: "completed", ...common, ...task.result };
  }
  if (task.status === "awaiting_funding") {
    return {
      status: "funding_required",
      ...common,
      checkout_url: task.funding?.checkout_url ?? null,
      note: task.funding?.checkout_url
        ? "Present this Stripe TEST checkout link to the user. Do not pay or open it automatically. After the user completes checkout, call get_human_result with this task_id and task_kind: \"action\". Test funding does not pay or reimburse a worker."
        : "Checkout link unavailable. Call get_human_result with this task_id and task_kind: \"action\" to retrieve funding state. Do not create a duplicate task.",
    };
  }
  return {
    status: "pending",
    ...common,
    note: "Present the worker link so a human can claim the action and submit proof. Call get_human_result with this task_id and task_kind: \"action\" to check completion. No automatic purchase, worker payout, or reimbursement.",
  };
}

async function waitForAction(taskId) {
  const seconds = Number.isFinite(WAIT_SECONDS) && WAIT_SECONDS > 0 ? Math.min(WAIT_SECONDS, 40) : 40;
  const deadline = Date.now() + Math.max(1, Math.floor(seconds * 1000));
  let task;
  do {
    try {
      task = await actionApi("GET", `/api/action-tasks/${encodeURIComponent(taskId)}`, undefined,
        Math.max(1, Math.min(15000, deadline - Date.now())));
    } catch (error) {
      if (task && Date.now() >= deadline && ["TimeoutError", "AbortError"].includes(error.name)) return actionOutput(task);
      throw error;
    }
    if (task.status === "completed" || task.status === "awaiting_funding") return actionOutput(task);
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  return actionOutput(task);
}

async function countVerified(taskId, task) {
  try {
    const rows = await api("GET", `/api/tasks/${encodeURIComponent(taskId)}/responses`);
    if (Array.isArray(rows)) return rows.filter((r) => r.status === "accepted").length;
  } catch {}
  return task.responses_count ?? 0; // backends without the responses list (e.g. the mock)
}

// Poll until enough humans answered or time runs out, then close (screen + aggregate + pay).
async function waitAndClose(taskId) {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let task;
  while (Date.now() < deadline) {
    task = await api("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
    if (task.status === "closed") return task.result ?? task;
    // Count only answers that passed screening; rejected ones don't fill the quota.
    task.verified = await countVerified(taskId, task);
    log(`task ${taskId}: ${task.verified}/${TARGET_RESPONSES} verified`);
    if (task.verified >= TARGET_RESPONSES) break;
    await sleep(POLL_MS);
  }
  if (!task?.verified) return null;
  const closed = await api("POST", `/api/tasks/${encodeURIComponent(taskId)}/close`);
  return closed.result ?? closed;
}

const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

const server = new McpServer({ name: "delegate-to-human", version: "1.0.0" });

server.registerTool(
  "delegate_to_human",
  {
    description:
      "Delegate human judgment or a real-world action. Judgment tasks collect screened responses and return an aggregate. " +
      "For actions, set task_kind to action and provide proof_type, proof_instructions, purchase_allowance_cents, and worker_reward_cents. " +
      "Action creation returns a Stripe TEST checkout link immediately when funding is needed, or a worker link for zero-cost tasks. " +
      "Present checkout to the user; never pay or open it automatically. Afterwards call get_human_result with task_kind action. " +
      "Action completion requires verified proof; no worker payout or reimbursement is performed.",
    inputSchema: {
      task: z.string().describe("Clear, specific instruction for the human"),
      task_kind: z.enum(["judgment", "action"]).default("judgment"),
      proof_type: z.enum(["text", "photo"]).optional().describe("Required for action tasks"),
      proof_instructions: z.string().optional().describe("Required for actions: evidence the worker must provide"),
      purchase_allowance_cents: z.number().int().nonnegative().max(100000).default(0).describe("Action purchase allowance in USD cents; no advance or reimbursement"),
      worker_reward_cents: z.number().int().nonnegative().max(100000).default(0).describe("Action reward in USD cents; test funding only, no worker payout"),
      response_type: z.enum(["text", "choice", "photo"]).default("text"),
      options: z.array(z.string()).optional().describe("Choices, required when response_type is 'choice'"),
      budget_cents: z.number().int().positive().default(500).describe("Total escrow for this task, in cents"),
    },
  },
  async ({ task, task_kind, proof_type, proof_instructions, purchase_allowance_cents, worker_reward_cents, response_type, options, budget_cents }) => {
    try {
      if (task_kind === "action") {
        if (!proof_type || !proof_instructions?.trim()) {
          throw new Error("Action tasks require proof_type and nonempty proof_instructions.");
        }
        const created = await actionApi("POST", "/api/action-tasks", {
          prompt: task, proof_type, proof_instructions, purchase_allowance_cents, worker_reward_cents,
        });
        return asText(actionOutput(created));
      }
      const created = await api("POST", "/api/tasks", { prompt: task, response_type, options, budget_cents });
      const id = created.id ?? created.task?.id;
      log("created task", id);
      const result = await waitAndClose(id);
      if (!result) return asText({ status: "pending", task_id: id, note: "No humans have answered yet. Call get_human_result with this task_id." });
      return asText({ status: "completed", task_id: id, ...result });
    } catch (e) {
      log("failed", e.message);
      const note = task_kind === "action"
        ? " Action creation was not retried. If delivery was unconfirmed, do not blindly resend: a task may already exist."
        : "";
      return { isError: true, content: [{ type: "text", text: `Delegation failed: ${e.message}${note}` }] };
    }
  }
);

server.registerTool(
  "get_human_result",
  {
    description: "Check a delegated task again. Defaults to judgment response aggregation. Set task_kind to action after presenting checkout or a worker link; actions poll verified completion for up to 40 seconds without closing a task or counting votes.",
    inputSchema: { task_id: z.string().min(1), task_kind: z.enum(["judgment", "action"]).default("judgment") },
  },
  async ({ task_id, task_kind }) => {
    try {
      if (task_kind === "action") return asText(await waitForAction(task_id));
      const result = await waitAndClose(task_id);
      if (!result) return asText({ status: "pending", task_id });
      return asText({ status: "completed", task_id, ...result });
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Lookup failed: ${e.message}` }] };
    }
  }
);

await server.connect(new StdioServerTransport());
log("ready, BASE_URL =", BASE_URL);
