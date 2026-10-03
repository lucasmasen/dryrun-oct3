// Calls the MCP tool the same way Claude Desktop would. Run: npm test
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["server.mjs"], env: { ...process.env } }));
console.log("Tools:", (await client.listTools()).tools.map((t) => t.name));
console.log("Calling delegate_to_human... (humans/bots must answer)");
const r = await client.callTool({
  name: "delegate_to_human",
  arguments: { task: "Which brunch spot for 4 this Saturday?", response_type: "choice", options: ["Zazie", "Plow"], budget_cents: 500 },
}, undefined, { timeout: 120000 });
console.log(r.content[0].text);
await client.close();
