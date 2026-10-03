// Launch several AI agents at once, each delegating through the real MCP tool.
// Shows the marketplace filling with tasks that no human wrote.
// Run: BASE_URL=https://dryrun-oct3-oct2.vercel.app npm run agents
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const AGENTS = [
  {
    name: "Launch agent",
    args: { task: "Which coffee brand name would you actually buy as a college student?", response_type: "choice", options: ["Night Owl Brew", "Cram Coffee", "Late Pages"], budget_cents: 450 },
  },
  {
    name: "Ops agent",
    args: { task: "Look around this room: what's one thing the organizers should fix right now?", response_type: "text", budget_cents: 300 },
  },
];

await Promise.all(AGENTS.map(async ({ name, args }, i) => {
  await new Promise((r) => setTimeout(r, i * 1500));
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: "node", args: [new URL("./server.mjs", import.meta.url).pathname], env: { ...process.env, WAIT_SECONDS: process.env.WAIT_SECONDS || "120" }, stderr: "ignore" }));
  console.log(`[${name}] delegate_to_human → "${args.task}"`);
  const r = await client.callTool({ name: "delegate_to_human", arguments: args }, undefined, { timeout: 300000 });
  const out = JSON.parse(r.content[0].text);
  console.log(`[${name}] ← ${out.status}: ${out.summary ?? out.note ?? ""}`);
  await client.close();
}));
