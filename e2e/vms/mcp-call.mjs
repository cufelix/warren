#!/usr/bin/env node
// Calls one tool on the hub's MCP endpoint over Streamable HTTP, as an agent
// like Codex or Cursor would. Prints the tool's text result (or the error).
//   mcp-call.mjs <hub> <token> <tool> <base64 json args>
const SDK = "/usr/local/lib/node_modules/warren-cli/node_modules/@modelcontextprotocol/sdk/dist/esm";
const { Client } = await import(`${SDK}/client/index.js`);
const { StreamableHTTPClientTransport } = await import(`${SDK}/client/streamableHttp.js`);
const [hub, token, tool, b64] = process.argv.slice(2);
const client = new Client({ name: "mcp-call", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${hub}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const result = await client.callTool({ name: tool, arguments: JSON.parse(Buffer.from(b64 ?? "e30=", "base64").toString()) });
console.log(JSON.stringify({ isError: !!result.isError, text: result.content?.[0]?.text ?? "" }));
await client.close();
