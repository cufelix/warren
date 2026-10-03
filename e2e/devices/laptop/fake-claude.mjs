#!/usr/bin/env node
// Fake Claude Code host: reads ./.mcp.json, starts the "warren" server exactly
// as Claude Code would (command, args, env over stdio) and records channel
// pushes in /tmp/pushed.jsonl. Tool calls are requested by appending JSON
// lines {"name": "...", "arguments": {...}} to /tmp/claude-cmds; results go to
// /tmp/claude-results.jsonl.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const SDK = "/usr/local/lib/node_modules/warren-cli/node_modules/@modelcontextprotocol/sdk/dist/esm";
const { Client } = await import(`${SDK}/client/index.js`);
const { StdioClientTransport } = await import(`${SDK}/client/stdio.js`);

const server = JSON.parse(readFileSync(".mcp.json", "utf8")).mcpServers.warren;
const client = new Client({ name: "fake-claude-code", version: "0" });
client.fallbackNotificationHandler = async (n) => {
  if (n.method === "notifications/claude/channel") appendFileSync("/tmp/pushed.jsonl", JSON.stringify(n.params) + "\n");
};
await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: { ...process.env, ...server.env } }));
appendFileSync("/tmp/claude-results.jsonl", JSON.stringify({ ready: (await client.listTools()).tools.map((t) => t.name) }) + "\n");

writeFileSync("/tmp/claude-cmds", "");
let done = 0;
setInterval(async () => {
  const lines = readFileSync("/tmp/claude-cmds", "utf8").split("\n").filter(Boolean);
  for (const line of lines.slice(done)) {
    done++;
    const result = await client.callTool(JSON.parse(line)).catch((e) => ({ error: e.message }));
    appendFileSync("/tmp/claude-results.jsonl", JSON.stringify(result) + "\n");
  }
}, 200);
