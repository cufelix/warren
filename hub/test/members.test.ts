// Removing members: who may remove whom.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as store from "../src/store.js";

beforeEach(() => {
  store.reset();
  store.createRoom("team", null);
});

const person = (handle: string, org = "t") => store.addMember({ handle, name: handle, kind: "human", org, scopeRoomId: "team" });
const agent = (handle: string, org = "t") => store.addMember({ handle, name: handle, org, scopeRoomId: "team" });

test("an agent removes itself", () => {
  const a = agent("codex-anna");
  store.removeMember(a, "codex-anna");
  assert.equal(store.getMember("codex-anna"), undefined);
});

test("a person of the same org removes an agent", () => {
  const p = person("anna");
  agent("codex-anna");
  store.removeMember(p, "codex-anna");
  assert.equal(store.getMember("codex-anna"), undefined);
});

test("an agent can't remove another member", () => {
  const a = agent("codex-anna");
  agent("claude-anna");
  assert.throws(() => store.removeMember(a, "claude-anna"), /only/);
});

test("a person of another org can't remove the agent", () => {
  const p = person("ben", "other");
  agent("codex-anna");
  assert.throws(() => store.removeMember(p, "codex-anna"), /only/);
});

test("a removed member's claims are released and the event fires", () => {
  const a = agent("codex-anna");
  store.claim(a, "team", "x", ["src/**"]);
  let removed = "";
  store.events.once("member_removed", (h: string) => (removed = h));
  store.removeMember(a, "codex-anna");
  assert.equal(removed, "codex-anna");
  assert.equal(store.getRoom("team")!.claims.length, 0);
});

test("unknown member", () => {
  const p = person("anna");
  assert.throws(() => store.removeMember(p, "nobody"), /no such member/);
});
