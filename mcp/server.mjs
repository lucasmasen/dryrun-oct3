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

async function countVerified(taskId, task) {
  try {
    const rows = await api("GET", `/api/tasks/${taskId}/responses`);
    if (Array.isArray(rows)) return rows.filter((r) => r.status === "accepted").length;
  } catch {}
  return task.responses_count ?? 0; // backends without the responses list (e.g. the mock)
}

// Poll until enough humans answered or time runs out, then close (screen + aggregate + pay).
async function waitAndClose(taskId) {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  let task;
  while (Date.now() < deadline) {
    task = await api("GET", `/api/tasks/${taskId}`);
    if (task.status === "closed") return task.result ?? task;
    // Count only answers that passed screening; rejected ones don't fill the quota.
    task.verified = await countVerified(taskId, task);
    log(`task ${taskId}: ${task.verified}/${TARGET_RESPONSES} verified`);
    if (task.verified >= TARGET_RESPONSES) break;
    await sleep(POLL_MS);
  }
  if (!task?.verified) return null;
  const closed = await api("POST", `/api/tasks/${taskId}/close`);
  return closed.result ?? closed;
}

const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

const server = new McpServer({ name: "delegate-to-human", version: "1.0.0" });

server.registerTool(
  "delegate_to_human",
  {
    description:
      "Delegate a real-world action or human judgment to verified humans. Use when you cannot know or do something yourself " +
      "(local opinions, taste, physical-world checks). Humans answer on their phones; responses are screened by AI, aggregated, " +
      "and the humans are paid from escrow. Returns the aggregated human data. Keep the task short and answerable in under 30 seconds.",
    inputSchema: {
      task: z.string().describe("Clear, specific instruction for the human"),
      response_type: z.enum(["text", "choice", "photo"]).default("text"),
      options: z.array(z.string()).optional().describe("Choices, required when response_type is 'choice'"),
      budget_cents: z.number().int().positive().default(500).describe("Total escrow for this task, in cents"),
    },
  },
  async ({ task, response_type, options, budget_cents }) => {
    try {
      const created = await api("POST", "/api/tasks", { prompt: task, response_type, options, budget_cents });
      const id = created.id ?? created.task?.id;
      log("created task", id);
      const result = await waitAndClose(id);
      if (!result) return asText({ status: "pending", task_id: id, note: "No humans have answered yet. Call get_human_result with this task_id." });
      return asText({ status: "completed", task_id: id, ...result });
    } catch (e) {
      log("failed", e.message);
      return { isError: true, content: [{ type: "text", text: `Delegation failed: ${e.message}` }] };
    }
  }
);

server.registerTool(
  "get_human_result",
  {
    description: "Check again for human responses on a task previously returned as pending by delegate_to_human.",
    inputSchema: { task_id: z.string() },
  },
  async ({ task_id }) => {
    try {
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
