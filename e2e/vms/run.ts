// Real end-to-end test: the hub on a VPS over the internet, two KVM laptops.
//
//   laptop-alice  @alice: Codex (stub) in /work/api, Cursor (stub) in /work/web, both via `warren wake`;
//                 its clock runs 10 minutes ahead of the hub
//   laptop-bob    @bob: Claude Code (fake host, starts the bridge from .mcp.json) in /work/app
//
// Covers join and rejoin, `warren add` for all three tools, wake and channel
// push, @room, inbox pull, MCP over HTTP, claims across laptops, safety
// (masking, loop guard, pause, contract approval), A2A, hub restart and
// outage, a laptop losing its network, a removed agent's bridge, leave and status.
//
//   HUB=http://<vps>:8790 JOIN_CODE=<code> VPS=<ssh host> npx tsx e2e/vms/run.ts
// VMs: e2e/vms/up.sh alice:2221 bob:2222 && e2e/vms/provision.sh <port> <tgz> (+ mcp-call.mjs)
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HUB = process.env.HUB!;
const CODE = process.env.JOIN_CODE!;
const VPS = process.env.VPS!; // ssh host running the hub container "warren-test-hub"
if (!HUB || !CODE || !VPS) throw new Error("set HUB, JOIN_CODE and VPS");
const PORTS = { alice: 2221, bob: 2222 } as const;
type Laptop = keyof typeof PORTS;
const QMP = fileURLToPath(new URL("qmp.sh", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: { ok: boolean; name: string }[] = [];
const check = (ok: boolean, name: string) => {
  results.push({ ok, name });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

/** Runs a command on a laptop VM; never throws, returns output and exit code. */
function vm(l: Laptop, cmd: string): { out: string; code: number } {
  try {
    const out = execFileSync("ssh", ["-q", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "ConnectTimeout=10", "-p", String(PORTS[l]), "felix@127.0.0.1", `{ ${cmd} ; } 2>&1`], {
      encoding: "utf8",
      timeout: 60_000,
    });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { out: err.stdout ?? "", code: err.status ?? 1 };
  }
}
/** Starts a long-running command on a laptop, detached, logging to `log`. */
const bg = (l: Laptop, cmd: string, log: string) => vm(l, `nohup bash -c '${cmd}' > ${log} 2>&1 < /dev/null & echo started`);
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const vps = (cmd: string) => execFileSync("ssh", [VPS, cmd], { encoding: "utf8", timeout: 120_000 });
const jsonLines = (l: Laptop, file: string) =>
  vm(l, `cat ${file} 2>/dev/null || true`)
    .out.split("\n")
    .filter((x) => x.startsWith("{"))
    .map((x) => JSON.parse(x));

async function waitFor<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 20_000): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    const v = await Promise.resolve(fn()).catch(() => undefined);
    if (v) return v;
  }
}

const api = (path: string, token?: string, body?: unknown, method = body ? "POST" : "GET") =>
  fetch(`${HUB}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const json = (path: string, token?: string, body?: unknown, method?: string) => api(path, token, body, method).then((r) => r.json());
const hubUp = () => fetch(`${HUB}/api/config`).then((r) => r.ok, () => false);
const online = async (token: string, handle: string, want = true) =>
  waitFor(async () => ((await json("/api/members", token)) as { handle: string; online: boolean }[]).find((m) => m.handle === handle)?.online === want, 45_000);

// Bob's fake Claude Code: tool calls go in through a command file, pushes come out in /tmp/pushed.jsonl.
const claude = (name: string, args: unknown) => vm("bob", `echo ${b64({ name, arguments: args })} | base64 -d >> /tmp/claude-cmds && echo >> /tmp/claude-cmds`);
const pushed = () => jsonLines("bob", "/tmp/pushed.jsonl") as { content: string; meta: Record<string, string> }[];
const codexPrompts = () => (jsonLines("alice", "/tmp/codex-calls.log") as { prompt: string }[]).map((c) => c.prompt);
const cursorCalls = () => jsonLines("alice", "/tmp/cursor-calls.log") as { prompt: string; args: string[] }[];
const mcp = (l: Laptop, token: string, tool: string, args: unknown = {}) =>
  JSON.parse(vm(l, `mcp-call.mjs ${HUB} ${token} ${tool} ${b64(args)}`).out.trim().split("\n").at(-1) ?? "{}") as { isError: boolean; text: string };
const post = (token: string, text: string, kind = "note", room = "junction") => json(`/api/rooms/${room}/messages`, token, { kind, text });
const folder = (l: Laptop, dir: string) => JSON.parse(vm(l, `cat ${dir}/.warren.json`).out) as { handle: string; token: string; session?: string };

try {
  // Fresh state on every laptop.
  for (const l of ["alice", "bob"] as const) vm(l, "pkill -f '[w]arren (wake|bridge)'; pkill -f '[f]ake-claude'; rm -rf /work ~/.warren /tmp/*.log /tmp/*.jsonl /tmp/claude-cmds; sudo mkdir -p /work && sudo chown felix /work");
  check(await hubUp(), "hub on the VPS answers over the internet");

  // --- A. join --------------------------------------------------------------
  const wrong = await api("/api/join", undefined, { code: "nope", name: "eve" });
  const page = await fetch(`${HUB}/join/${CODE}`).then((r) => r.text());
  check(wrong.status === 403 && page.includes("warren-cli login"), "join: a wrong code is refused; the join page shows the command");
  const la = vm("alice", `warren login ${HUB}/join/${CODE} --name alice`);
  const lb = vm("bob", `warren login ${HUB}/join/${CODE} --name bob`);
  check(la.out.includes("as @alice") && lb.out.includes("as @bob"), "join: both laptops log in with the link");
  const alice = JSON.parse(vm("alice", "cat ~/.warren/config.json").out).token as string;
  const bob = JSON.parse(vm("bob", "cat ~/.warren/config.json").out).token as string;
  const again = vm("bob", `WARREN_HOME=/tmp/alice-2nd warren login ${HUB}/join/${CODE} --name Alice && cat /tmp/alice-2nd/config.json`);
  check(again.out.includes(alice), "join: alice logging in on a second laptop gets the same identity");

  // --- B. add ---------------------------------------------------------------
  const addCodex = vm("alice", "mkdir -p /work/api && cd /work/api && warren add codex && cat .codex/config.toml .gitignore");
  check(
    addCodex.out.includes("@codex-alice") && addCodex.out.includes(`url = "${HUB}/mcp"`) && addCodex.out.includes('"Authorization" = "Bearer wr_') && addCodex.out.includes(".codex/config.toml"),
    "add codex: .codex/config.toml points at the VPS hub with a bearer header, token files gitignored",
  );
  const addCursor = vm("alice", "mkdir -p /work/web && cd /work/web && warren add cursor && cat .cursor/mcp.json .cursor/cli.json");
  check(addCursor.out.includes("@cursor-alice") && addCursor.out.includes(`"url": "${HUB}/mcp"`) && addCursor.out.includes("Mcp(warren:*)"), "add cursor: .cursor/mcp.json and cli.json pre-approving warren tools");
  const addClaude = vm("bob", "mkdir -p /work/app && cd /work/app && warren add claude && cat .mcp.json CLAUDE.md");
  check(addClaude.out.includes("@claude-bob") && addClaude.out.includes("WARREN_ADAPTER") && addClaude.out.includes("You are @claude-bob"), "add claude: .mcp.json starts the bridge, CLAUDE.md has the standing instruction");
  const twice = vm("bob", "cd /work/app && warren add claude");
  check(twice.code !== 0 && twice.out.includes("already @claude-bob"), "add: a folder that is already wired is refused");
  const asName = vm("bob", "mkdir -p /work/ui && cd /work/ui && warren add claude --as bob-ui");
  check(asName.out.includes("@bob-ui"), "add --as: a second Claude with its own handle");
  // The dashboard's "Add agent": a person creates the agent, the laptop adopts it with --token.
  const viaDash = await json("/api/invites", bob, { name: "codex-bob", kind: "agent", org: "junction", room: "junction", adapter: "exec" });
  const adopt = vm("bob", `mkdir -p /work/svc && cd /work/svc && warren add codex --hub ${HUB} --token ${viaDash.token} && warren status`);
  check(adopt.out.includes("@codex-bob") && adopt.out.includes("This folder: @codex-bob"), "add --token: an agent made in the dashboard is adopted by a folder");
  const status = vm("alice", "cd /work/api && warren status");
  check(status.out.includes("@alice in junction (hub reachable)") && status.out.includes("@codex-alice (codex, offline)"), "status: identity, hub reachable, this folder's agent");
  const outside = vm("alice", "mkdir -p /work/side && cd /work/side && warren status");
  check(outside.out.includes("no agent"), "status: a folder that wasn't added has no agent");

  // --- C. delivery across laptops -------------------------------------------
  // alice's clock runs 10 minutes ahead of the hub: replay must not depend on it.
  vm("alice", "sudo timedatectl set-ntp false; sudo date -s '+10 minutes' > /dev/null");
  const skew = Math.round((Date.parse(vm("alice", "date -u +%Y-%m-%dT%H:%M:%SZ").out.trim()) - Date.now()) / 60_000);
  bg("alice", "cd /work/api && warren wake", "/tmp/wake-codex.log");
  bg("alice", "cd /work/web && warren wake", "/tmp/wake-cursor.log");
  bg("bob", "cd /work/app && fake-claude.mjs", "/tmp/claude.log");
  const allOnline = (await online(alice, "codex-alice")) && (await online(alice, "cursor-alice")) && (await online(alice, "claude-bob"));
  check(!!allOnline, `delivery: codex-alice, cursor-alice (laptop-alice, clock +${skew} min) and claude-bob are online`);
  check(!!folder("alice", "/work/web").session, "wake cursor: created a chat and saved it in .warren.json");

  claude("post", { room: "junction", kind: "question", text: "@codex-alice add the /health endpoint" });
  const woke = await waitFor(() => codexPrompts().find((p) => p.includes("/health endpoint")));
  check(!!woke && woke.includes("from @claude-bob"), "delivery: bob's Claude mention wakes Codex on laptop-alice");
  check(!!(await waitFor(() => pushed().find((p) => p.content.includes("done: add the /health endpoint") && p.meta.from === "codex-alice"))), "delivery: Codex's answer is pushed into bob's Claude session");
  claude("post", { room: "junction", kind: "question", text: "@cursor-alice style the login form" });
  const cur = await waitFor(() => cursorCalls().find((c) => c.prompt.includes("login form")));
  check(!!cur && cur.args.includes("--resume") && cur.args.includes(folder("alice", "/work/web").session!), "delivery: a Cursor mention resumes the saved chat on laptop-alice");
  check(!!(await waitFor(() => pushed().find((p) => p.content.includes("cursor done: style the login form")))), "delivery: Cursor's answer reaches bob's Claude");
  const before = codexPrompts().length + cursorCalls().length;
  claude("post", { room: "junction", kind: "note", text: "just thinking out loud, nobody tagged" });
  await sleep(4000);
  check(codexPrompts().length + cursorCalls().length === before, "delivery: an untagged note wakes nobody");
  claude("post", { room: "junction", kind: "contract_change", text: "@room API base path is now /v2" });
  const roomBoth = await waitFor(() => codexPrompts().some((p) => p.includes("/v2")) && cursorCalls().some((c) => c.prompt.includes("/v2")));
  check(!!roomBoth, "delivery: @room reaches both agents on laptop-alice");
  await post(bob, "@bob-ui can you check the colors?");
  const uiToken = folder("bob", "/work/ui").token;
  const pulled = await json("/api/inbox", uiToken);
  check(pulled.some((m: { text: string }) => m.text.includes("check the colors")), "delivery: an agent without a bridge pulls its mention from the inbox");
  const who = mcp("alice", folder("alice", "/work/api").token, "whoami");
  check(!who.isError && who.text.includes('"handle": "codex-alice"'), "MCP over HTTP from laptop-alice: whoami as codex-alice");

  // --- D. coordination across laptops ---------------------------------------
  const codexTok = folder("alice", "/work/api").token;
  const claim = mcp("alice", codexTok, "claim", { room: "junction", task: "health endpoint", files: ["src/api/**"] });
  claude("claim", { room: "junction", task: "cart fix", files: ["src/api/cart.ts"] });
  const refused = await waitFor(() => jsonLines("bob", "/tmp/claude-results.jsonl").find((r: { content?: { text: string }[] }) => r.content?.[0]?.text.includes("is locked by")));
  check(!claim.isError && !!refused && JSON.stringify(refused).includes("@codex-alice"), "claims: bob's Claude can't lock a file codex-alice holds, and is told who");
  const claimId = JSON.parse(claim.text).id;
  mcp("alice", codexTok, "release", { claim: claimId });
  const retry = mcp("bob", folder("bob", "/work/ui").token, "claim", { room: "junction", task: "cart fix", files: ["src/api/cart.ts"] });
  check(!retry.isError, "claims: after release the other laptop gets the lock");
  const sub = mcp("alice", codexTok, "create_subroom", { parent: "junction", name: "payments", context: "# payments\nStripe test mode only." });
  const seen = mcp("bob", uiToken, "read_room", { room: "payments" });
  check(!sub.isError && seen.text.includes("Stripe test mode only"), "rooms: a subroom made on laptop-alice is readable from laptop-bob");

  // --- E. safety --------------------------------------------------------------
  const masked = await post(folder("bob", "/work/ui").token, "@codex-alice use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");
  const maskedPush = await waitFor(() => codexPrompts().find((p) => p.includes("use key")));
  check(masked.safety.redactions.includes("anthropic-key") && !!maskedPush && maskedPush.includes("[redacted:anthropic-key]") && !maskedPush.includes("sk-ant-api03"), "safety: a pasted API key is masked before it reaches the other laptop");
  await json("/api/members/codex-alice/pause", alice, { paused: true });
  const n = codexPrompts().length;
  claude("post", { room: "junction", kind: "question", text: "@codex-alice are you there while paused?" });
  await sleep(5000);
  check(codexPrompts().length === n, "safety: a paused agent isn't woken");
  await json("/api/members/codex-alice/pause", alice, { paused: false });
  claude("post", { room: "junction", kind: "question", text: "@codex-alice back after resume?" });
  check(!!(await waitFor(() => codexPrompts().find((p) => p.includes("back after resume")))), "safety: after resume it's woken again");
  await json("/api/rooms/payments/policy", alice, { approveContractChanges: true }, "PUT");
  const proposal = await post(uiToken, "@codex-alice charge in cents, not euros", "contract_change", "payments");
  const release = await json(`/api/messages/${proposal.id}/review`, bob, { decision: "release" });
  const approved = await waitFor(() => codexPrompts().find((p) => p.includes("charge in cents")));
  check(proposal.safety.status === "held" && release.safety?.status === "released" && !!approved, "safety: an agent's contract change waits for its person's approval, then goes out");
  for (let i = 0; i < 9; i++) await post(uiToken, `loop ${i}`, "note", "payments");
  const last = (await json("/api/rooms/payments/messages", bob)).at(-1);
  check(last.safety.status === "held" && last.safety.flags.includes("agent-loop"), "safety: agents talking without a person get held after 8 messages");

  // --- F. A2A -----------------------------------------------------------------
  const card = await json("/.well-known/agent-card.json");
  const a2a = vm(
    "alice",
    `curl -s ${HUB}/a2a -H 'Authorization: Bearer ${codexTok}' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"parts":[{"kind":"text","text":"hello over A2A"}]}}}'`,
  );
  check(card.url === `${HUB}/a2a` && a2a.out.includes("Posted to #junction"), "A2A: agent card names the VPS url; message/send from laptop-alice posts");

  // --- G. resilience ------------------------------------------------------------
  const msgsBefore = (await json("/api/rooms/junction/messages", bob)).length;
  vps("docker restart warren-test-hub > /dev/null");
  await waitFor(hubUp, 60_000);
  const msgsAfter = (await json("/api/rooms/junction/messages", bob)).length;
  const reconnected = (await online(alice, "codex-alice")) && (await online(alice, "claude-bob"));
  check(msgsAfter === msgsBefore && !!reconnected, `hub restart on the VPS: ${msgsAfter} messages kept, bridges on both laptops reconnect`);
  claude("post", { room: "junction", kind: "question", text: "@codex-alice still there after the restart?" });
  check(!!(await waitFor(() => codexPrompts().find((p) => p.includes("after the restart")))), "hub restart: a mention round-trips again");

  // A person speaks first: otherwise the loop guard holds the next agent message (agents have talked a lot by now).
  await post(bob, "ok team, carry on");
  execFileSync(QMP, ["alice", "down"]);
  const wentOffline = await online(bob, "codex-alice", false);
  claude("post", { room: "junction", kind: "question", text: "@codex-alice fix the footer while your cable is out" });
  await sleep(3000);
  const missed = codexPrompts().some((p) => p.includes("cable is out")); // alice's log can't be read while offline: read after
  execFileSync(QMP, ["alice", "up"]);
  await waitFor(() => codexPrompts().some((p) => p.includes("cable is out")), 60_000);
  await sleep(3000);
  const footer = codexPrompts().filter((p) => p.includes("cable is out")).length;
  // With user-mode networking QEMU keeps the outer TCP connection alive, so the hub may not see the drop.
  console.log(`      (hub saw laptop-alice offline during the cable pull: ${!!wentOffline})`);
  check(!missed && footer === 1, `network drop: laptop-alice (clock +${skew} min) gets the missed mention exactly once after reconnecting (${footer}x)`);

  // Dead Wi-Fi: packets from the hub silently vanish (no reset, no close). The bridge
  // notices the missing pings after 45 s, reconnects once the network is back and replays.
  await post(bob, "still here, team");
  const vpsIp = new URL(HUB).hostname;
  vm("alice", `sudo iptables -I INPUT -s ${vpsIp} -j DROP`);
  claude("post", { room: "junction", kind: "question", text: "@codex-alice the wifi ate this one" });
  await sleep(60_000);
  vm("alice", `sudo iptables -D INPUT -s ${vpsIp} -j DROP`);
  await waitFor(() => codexPrompts().some((p) => p.includes("wifi ate this one")), 60_000);
  await sleep(3000);
  const eaten = codexPrompts().filter((p) => p.includes("wifi ate this one")).length;
  const noticed = vm("alice", "cat /tmp/wake-codex.log").out.includes("no data from the hub");
  check(noticed && eaten === 1, `dead Wi-Fi: the bridge notices the silence, reconnects and delivers the mention once (${eaten}x)`);

  vps("docker stop warren-test-hub > /dev/null");
  await sleep(20_000);
  vps("docker start warren-test-hub > /dev/null");
  await waitFor(hubUp, 60_000);
  check(!!(await online(alice, "codex-alice")) && !!(await online(alice, "claude-bob")), "hub down for 20 s: bridges keep retrying and come back by themselves");

  await api("/api/members/cursor-alice", alice, undefined, "DELETE");
  const stopped = await waitFor(() => vm("alice", "cat /tmp/wake-cursor.log").out.includes("no longer knows this token") && vm("alice", "pgrep -f '[w]arren wake' | wc -l").out.trim() === "1", 30_000);
  check(!!stopped, "removed agent: cursor-alice's wake bridge stops by itself (codex's keeps running)");

  // --- H. leave -----------------------------------------------------------------
  vps("docker stop warren-test-hub > /dev/null");
  const offlineLeave = vm("bob", "cd /work/ui && warren leave; ls -a");
  check(offlineLeave.code === 0 && offlineLeave.out.includes("can't reach") && offlineLeave.out.includes(".warren.json"), "leave with the hub down: refused, the folder keeps its token to retry");
  vps("docker start warren-test-hub > /dev/null");
  await waitFor(hubUp, 60_000);
  const leaveUi = vm("bob", "cd /work/ui && warren leave && ls -a && cat .mcp.json");
  const leaveApp = vm("bob", "pkill -f '[f]ake-claude'; cd /work/app && warren leave && ls -a && cat .mcp.json; warren status");
  const handles = ((await json("/api/members", alice)) as { handle: string }[]).map((m) => m.handle);
  check(
    leaveUi.out.includes("left") && !leaveApp.out.includes("CLAUDE.md") && !leaveApp.out.includes("WARREN_TOKEN") && leaveApp.out.includes("no agent") && !handles.includes("bob-ui") && !handles.includes("claude-bob"),
    "leave: agents removed from the hub, .mcp.json cleaned, CLAUDE.md (made by warren) deleted",
  );
} catch (e) {
  console.error(e);
  check(false, `driver crashed: ${(e as Error).message}`);
} finally {
  vm("alice", "pkill -f '[w]arren (wake|bridge)'; sudo timedatectl set-ntp true");
  vm("bob", "pkill -f '[w]arren (wake|bridge)'; pkill -f '[f]ake-claude'");
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
