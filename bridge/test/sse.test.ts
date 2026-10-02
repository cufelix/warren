// The bridge's SSE subscription: after a reconnect it replays what it missed
// by message id, never by the laptop's clock, and delivers each message once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { subscribe, type HubMessage } from "../src/sse.js";

const msg = (id: string, at: string): HubMessage => ({ id, roomId: "r", from: "x", kind: "note", text: id, mentions: ["me"], mentionsRoom: false, at });

test("replays missed mentions by id after a reconnect, once each", async () => {
  // Server timestamps far in the past: a time-based replay would drop m2.
  const history = [msg("m0", "2000-01-01T00:00:00.000Z")];
  const inboxQueries: string[] = [];
  let stream: ServerResponse | undefined;
  let connects = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    if (url.pathname === "/api/inbox") {
      inboxQueries.push(url.search);
      const since = url.searchParams.get("since");
      const idx = since ? history.findIndex((m) => m.id === since) : -1;
      return void res.end(JSON.stringify(history.slice(idx + 1)));
    }
    connects++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": connected\n\n");
    stream = res;
  });
  await new Promise<void>((r) => server.listen(0, r));
  const hub = `http://localhost:${(server.address() as AddressInfo).port}`;

  const got: string[] = [];
  const ctl = new AbortController();
  void subscribe(hub, "tok", (m) => void got.push(m.id), { signal: ctl.signal, retryMs: 50 });
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20));
  };

  await until(() => connects === 1);
  const m1 = msg("m1", "2000-01-01T00:00:01.000Z");
  history.push(m1);
  stream!.write(`event: message\ndata: ${JSON.stringify(m1)}\n\n`);
  await until(() => got.length === 1);

  // Stream drops; m2 arrives while the bridge is away.
  stream!.destroy();
  history.push(msg("m2", "2000-01-01T00:00:02.000Z"));
  await until(() => connects === 2 && got.length === 2);
  // The live stream repeats m2 as well: still delivered once.
  stream!.write(`event: message\ndata: ${JSON.stringify(history[2])}\n\n`);
  await new Promise((r) => setTimeout(r, 100));

  ctl.abort();
  stream!.destroy();
  server.close();
  assert.deepEqual(got, ["m1", "m2"], "m0 was history before start, m1 live, m2 replayed");
  assert.equal(inboxQueries[0], "?all=1", "primes the cursor from history without delivering it");
  assert.equal(inboxQueries.at(-1), "?since=m1", "replays from the last id it knows");
});
