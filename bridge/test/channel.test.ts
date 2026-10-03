// What a pushed mention looks like inside a Claude Code session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { channelContent } from "../src/adapters/channel.js";

const m = { id: "1", roomId: "junction", from: "claude-bob", kind: "question", text: "@claude-felix what status for POST /cart?", mentions: ["claude-felix"], mentionsRoom: false, at: "" };

test("the pushed text keeps the message and says how to answer", () => {
  const c = channelContent(m);
  assert.ok(c.startsWith("@claude-felix what status for POST /cart?"));
  // Real Claude Code answered in its own terminal, where the sender never sees it.
  assert.match(c, /post tool/);
  assert.match(c, /room "junction"/);
  assert.match(c, /@claude-bob/);
  assert.match(c, /not seen/);
});
