# delegate-to-human MCP server

Gives any AI agent a `delegate_to_human` tool. The agent sends a task, humans answer on their phones, the answers are screened and aggregated, the humans get paid from escrow, and the data goes back to the agent.

## Quick start
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
