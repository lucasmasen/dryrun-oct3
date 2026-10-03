// Fake version of Sree's backend so you can test before the real one exists.
// Run: npm run mock   (then visit http://localhost:4000)
import http from "node:http";

const PORT = Number(process.env.PORT || 4000);
const tasks = new Map();
let nextId = 1;

const send = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : {})); });

function summarize(task) {
  const counts = {};
  for (const r of task.responses) counts[r.answer] = (counts[r.answer] || 0) + 1;
  const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const each = Math.floor(task.budget_cents / task.responses.length);
  return {
    summary: `${task.responses.length} verified humans answered. Most common answer: ${winner}`,
    winner,
    responses: task.responses,
    paid: { total_cents: each * task.responses.length, per_human_cents: each, stripe: "pi_" + Math.random().toString(36).slice(2, 14) },
  };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean); // ["api","tasks",id,...]
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const b = await readBody(req);
    const task = { id: String(nextId++), prompt: b.prompt, response_type: b.response_type, options: b.options, budget_cents: b.budget_cents ?? 500, status: "open", responses: [] };
    tasks.set(task.id, task);
    console.log("NEW TASK", task.id, task.prompt);
    return send(res, 200, { id: task.id, status: "open" });
  }
  if (req.method === "GET" && url.pathname === "/api/tasks") {
    return send(res, 200, [...tasks.values()].map(({ responses, ...t }) => ({ ...t, responses_count: responses.length })));
  }
  const task = parts[0] === "api" && parts[1] === "tasks" ? tasks.get(parts[2]) : null;
  if (!task) return send(res, 404, { error: "not found" });

  if (req.method === "GET" && parts.length === 3) {
    return send(res, 200, { ...task, responses_count: task.responses.length });
  }
  if (req.method === "POST" && parts[3] === "responses") {
    const b = await readBody(req);
    task.responses.push({ answer: b.answer, name: b.name || "anon" });
    console.log("RESPONSE", task.id, b.answer);
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && parts[3] === "close") {
    task.status = "closed";
    task.result = summarize(task);
    console.log("CLOSED", task.id, task.result.summary);
    return send(res, 200, { id: task.id, status: "closed", result: task.result });
  }
  send(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`Mock backend on http://localhost:${PORT}`));
