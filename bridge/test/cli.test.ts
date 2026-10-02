// CLI helpers: join links, agent names, how Claude Code starts the bridge, saved identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentHandle, bridgeCommand, loadIdentity, parseJoinUrl, saveIdentity } from "../src/cli/config.js";

test("parseJoinUrl splits a join link into hub and code", () => {
  assert.deepEqual(parseJoinUrl("https://hub.example.com/join/abc123"), { hub: "https://hub.example.com", code: "abc123" });
  assert.deepEqual(parseJoinUrl("http://100.64.0.3:8790/join/x9/"), { hub: "http://100.64.0.3:8790", code: "x9" });
  assert.deepEqual(parseJoinUrl("http://localhost:8790/base/join/c"), { hub: "http://localhost:8790/base", code: "c" });
  assert.throws(() => parseJoinUrl("https://hub.example.com/"), /join link/);
  assert.throws(() => parseJoinUrl("not a url"), /join link/);
});

test("agentHandle: tool-person, or the --as name", () => {
  assert.equal(agentHandle("claude", "felix"), "claude-felix");
  assert.equal(agentHandle("codex", "felix", "Felix API"), "felix-api");
});

test("bridgeCommand: node + compiled cli, tsx for sources, npx from the npx cache", () => {
  assert.deepEqual(bridgeCommand("/opt/w/dist/cli.js", "/usr/bin/node", "1.0.0"), { command: "/usr/bin/node", args: ["/opt/w/dist/cli.js", "bridge"] });
  assert.deepEqual(bridgeCommand("/repo/bridge/src/cli.ts", "/usr/bin/node", "1.0.0"), { command: "npx", args: ["tsx", "/repo/bridge/src/cli.ts", "bridge"] });
  assert.deepEqual(bridgeCommand("/home/u/.npm/_npx/ab12/node_modules/warren-cli/dist/cli.js", "/usr/bin/node", "1.2.3"), {
    command: "npx",
    args: ["-y", "warren-cli@1.2.3", "bridge"],
  });
});

test("identity is saved under WARREN_HOME and loaded back", () => {
  const home = mkdtempSync(join(tmpdir(), "warren-home-"));
  assert.equal(loadIdentity(home), undefined);
  saveIdentity(home, { hub: "http://h", token: "wr_1", handle: "felix" });
  assert.deepEqual(loadIdentity(home), { hub: "http://h", token: "wr_1", handle: "felix" });
});
