// Config writers: wire one folder's agent to Warren without touching anything else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addGitignore, unwireFolder, wireFolder, type Wiring } from "../src/cli/writers.js";

const dir = () => mkdtempSync(join(tmpdir(), "warren-w-"));
const read = (d: string, f: string) => readFileSync(join(d, f), "utf8");
const json = (d: string, f: string) => JSON.parse(read(d, f));
const wiring = (tool: Wiring["tool"]): Wiring => ({
  tool,
  hub: "http://hub:8790",
  token: "wr_abc123",
  handle: `${tool}-felix`,
  bridge: { command: "/usr/bin/node", args: ["/opt/warren/cli.js", "bridge"] },
});

test("claude: adds the warren server to .mcp.json and keeps other servers", () => {
  const d = dir();
  writeFileSync(join(d, ".mcp.json"), JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }));
  wireFolder(d, wiring("claude"));
  const cfg = json(d, ".mcp.json");
  assert.deepEqual(cfg.mcpServers.github, { command: "gh-mcp" });
  assert.deepEqual(cfg.mcpServers.warren, {
    command: "/usr/bin/node",
    args: ["/opt/warren/cli.js", "bridge"],
    env: { WARREN_HUB: "http://hub:8790", WARREN_TOKEN: "wr_abc123", WARREN_ADAPTER: "channel" },
  });
});

test("claude: unwire removes only warren", () => {
  const d = dir();
  writeFileSync(join(d, ".mcp.json"), JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }));
  wireFolder(d, wiring("claude"));
  unwireFolder(d, "claude");
  assert.deepEqual(json(d, ".mcp.json"), { mcpServers: { github: { command: "gh-mcp" } } });
});

test("codex: writes a managed block into .codex/config.toml, re-adding replaces it", () => {
  const d = dir();
  mkdirSync(join(d, ".codex"));
  writeFileSync(join(d, ".codex/config.toml"), 'model = "gpt-5"\n');
  wireFolder(d, wiring("codex"));
  wireFolder(d, { ...wiring("codex"), token: "wr_new456" });
  const toml = read(d, ".codex/config.toml");
  assert.ok(toml.startsWith('model = "gpt-5"\n'));
  assert.equal(toml.match(/\[mcp_servers\.warren\]/g)?.length, 1);
  assert.ok(toml.includes('url = "http://hub:8790/mcp"'));
  assert.ok(toml.includes('http_headers = { "Authorization" = "Bearer wr_new456" }'));
  unwireFolder(d, "codex");
  assert.equal(read(d, ".codex/config.toml"), 'model = "gpt-5"\n');
});

test("codex: refuses to clobber a hand-written warren server", () => {
  const d = dir();
  mkdirSync(join(d, ".codex"));
  writeFileSync(join(d, ".codex/config.toml"), '[mcp_servers.warren]\nurl = "x"\n');
  assert.throws(() => wireFolder(d, wiring("codex")), /already has \[mcp_servers\.warren\]/);
});

test("cursor: mcp.json with the bearer header, cli.json pre-approves only warren tools", () => {
  const d = dir();
  mkdirSync(join(d, ".cursor"));
  writeFileSync(join(d, ".cursor/cli.json"), JSON.stringify({ permissions: { allow: ["Shell(ls)"], deny: [] } }));
  wireFolder(d, wiring("cursor"));
  wireFolder(d, wiring("cursor"));
  assert.deepEqual(json(d, ".cursor/mcp.json").mcpServers.warren, {
    url: "http://hub:8790/mcp",
    headers: { Authorization: "Bearer wr_abc123" },
  });
  assert.deepEqual(json(d, ".cursor/cli.json").permissions.allow, ["Shell(ls)", "Mcp(warren:*)"]);
  unwireFolder(d, "cursor");
  assert.deepEqual(json(d, ".cursor/cli.json").permissions.allow, ["Shell(ls)"]);
  assert.equal(json(d, ".cursor/mcp.json").mcpServers.warren, undefined);
});

test("wireFolder records the member in .warren.json; unwire deletes it", () => {
  const d = dir();
  wireFolder(d, wiring("codex"));
  assert.deepEqual(json(d, ".warren.json"), { tool: "codex", hub: "http://hub:8790", handle: "codex-felix", token: "wr_abc123" });
  unwireFolder(d, "codex");
  assert.equal(existsSync(join(d, ".warren.json")), false);
});

test("addGitignore appends missing entries once", () => {
  const d = dir();
  writeFileSync(join(d, ".gitignore"), "node_modules/");
  addGitignore(d, [".warren.json", ".mcp.json"]);
  addGitignore(d, [".warren.json", ".mcp.json"]);
  assert.equal(read(d, ".gitignore"), "node_modules/\n# warren (tokens)\n.warren.json\n.mcp.json\n");
});
