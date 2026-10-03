// warren-bridge: runs next to the agent, subscribes to the hub and delivers
// every message that @mentions the agent (or @room) with the adapter its
// client supports:
//
//   channel  Claude Code: stdio MCP channel, pushes into the live session
//   exec     Codex: wakes the session with `codex exec resume <id> "<msg>"`
//
// The bridge is also a stdio MCP server that proxies the hub's MCP tools
// one to one, so Claude Code needs only this one entry in .mcp.json.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { subscribe, type HubMessage } from "./sse.js";
import { deliverViaChannel } from "./adapters/channel.js";

/**
 * Runs the bridge with settings from the environment: WARREN_HUB, WARREN_TOKEN,
 * WARREN_ADAPTER (channel | exec). WARREN_STDIO=0 skips the stdio MCP server:
 * `warren wake` runs an exec bridge in the background, where nobody speaks MCP
 * on stdin (Codex and Cursor reach the hub's tools over HTTP themselves).
 */
export async function runBridge() {
  const HUB = process.env.WARREN_HUB ?? "http://localhost:8790";
  const TOKEN = process.env.WARREN_TOKEN;
  const ADAPTER = process.env.WARREN_ADAPTER ?? "channel";
  if (!TOKEN) {
    console.error("warren-bridge: set WARREN_TOKEN (get one from POST /api/invites)");
    process.exit(1);
  }
  if (ADAPTER === "exec" && process.env.WARREN_STDIO === "0") {
    // Read at import: the exec adapter checks its env (client, session) when loaded.
    const { deliverViaExec } = await import("./adapters/exec.js");
    console.error(`warren-bridge: waking ${process.env.WARREN_EXEC_CLIENT ?? "codex"} on mentions (Ctrl+C stops)`);
    return subscribe(HUB, TOKEN, deliverViaExec);
  }

  // Upstream: the hub's MCP endpoint, as this member.
  const hub = new Client({ name: "warren-bridge", version: "0.2.0" });
  await hub.connect(
    new StreamableHTTPClientTransport(new URL(`${HUB}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );

  const mcp = new Server(
    { name: "warren", version: "0.2.0" },
    {
      capabilities: { tools: {}, experimental: { "claude/channel": {} } },
      instructions:
        'Messages that @mention you arrive as <channel source="warren" room="..." from="..." kind="...">. ' +
        "Answer in the same room with the post tool and @mention the sender (the from attribute). " +
        (hub.getInstructions() ?? ""),
    },
  );
  mcp.setRequestHandler(ListToolsRequestSchema, () => hub.listTools());
  mcp.setRequestHandler(CallToolRequestSchema, (req) => hub.callTool(req.params) as never);

  // When the host closes our stdio, stop: a leftover SSE subscription would keep
  // the member "online" and swallow mentions nobody delivers.
  mcp.onclose = () => process.exit(0);
  process.stdin.on("end", () => process.exit(0));
  await mcp.connect(new StdioServerTransport());

  const deliver =
    ADAPTER === "exec"
      ? await import("./adapters/exec.js").then(({ deliverViaExec }) => deliverViaExec)
      : (m: HubMessage) => deliverViaChannel(mcp, m);

  return subscribe(HUB, TOKEN, deliver);
}
