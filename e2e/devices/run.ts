// Multi-device test: a hub and two laptops in separate containers.
//
//   laptop-a  @alice, Codex agent (stub) woken by `warren wake`
//   laptop-b  @bob, Claude Code agent (fake host started from .mcp.json)
//
// 1. both join with the team link; each folder's agent is wired with `warren add`
// 2. bob's Claude @mentions alice's Codex -> Codex is woken on laptop-a and answers -> pushed into bob's session
// 3. a folder that didn't `warren add` isn't a member
// 4. the hub restarts: tokens, members and messages survive, delivery resumes
// 5. laptop-a drops off the network; a mention sent meanwhile arrives once after it's back
// 6. `warren leave` removes the agent and cleans the folder
//
// Needs docker. `npm run devices` (KEEP=1 leaves the containers up).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "../..");
// The hub by container IP: works where port publishing to localhost doesn't (sandboxes).
let HUB = "";
const findHub = () => {
  const ip = execFileSync("docker", ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", "warren-devices-hub-1"], { encoding: "utf8" }).trim();
  HUB = `http://${ip}:3000`;
};
const JOIN = "http://hub:3000/join/devices";
const NET = "warren-devices_venue";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const check = (ok: boolean, name: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed = true;
};

const compose = (...args: string[]) => execFileSync("docker", ["compose", "-f", join(HERE, "docker-compose.yml"), ...args], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
/** Runs a shell command on a laptop; returns stdout (stderr folded in). */
const on = (laptop: string, cmd: string) =>
  execFileSync("docker", ["exec", `warren-devices-${laptop}-1`, "sh", "-c", `${cmd} 2>&1`], { encoding: "utf8" });
const bg = (laptop: string, cmd: string) => execFileSync("docker", ["exec", "-d", `warren-devices-${laptop}-1`, "sh", "-c", cmd]);
const file = (laptop: string, path: string) => on(laptop, `cat ${path} 2>/dev/null || true`);
const lines = (laptop: string, path: string) =>
  file(laptop, path)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

async function waitFor<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 15_000): Promise<T | undefined> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) {
    const v = await Promise.resolve(fn()).catch(() => undefined);
    if (v) return v;
  }
}

const hubUp = () => fetch(`${HUB}/.well-known/agent-card.json`).then((r) => r.ok, () => false);
const members = (token: string): Promise<{ handle: string; online: boolean }[]> =>
  fetch(`${HUB}/api/members`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const online = (token: string, handle: string) => waitFor(async () => (await members(token)).find((m) => m.handle === handle)?.online);
const claudeCall = (name: string, args: unknown) => on("laptop-b", `echo '${JSON.stringify({ name, arguments: args })}' >> /tmp/claude-cmds`);
const codexPrompts = () => lines("laptop-a", "/tmp/codex-calls.log").map((c: { prompt: string }) => c.prompt);
const pushed = () => lines("laptop-b", "/tmp/pushed.jsonl") as { content: string; meta: Record<string, string> }[];

try {
  // Pack the CLI like npm would publish it, and build the three devices.
  const pack = mkdtempSync(join(tmpdir(), "warren-pack-"));
  execFileSync("npm", ["pack", "-w", "bridge", "--pack-destination", pack], { cwd: ROOT, stdio: "ignore" });
  copyFileSync(join(pack, readdirSync(pack).find((f) => f.endsWith(".tgz"))!), join(HERE, "laptop/warren-cli.tgz"));
  compose("down", "-v", "--remove-orphans");
  console.log("building and starting hub, laptop-a, laptop-b ...");
  compose("build");
  compose("up", "-d");
  findHub();
  if (!(await waitFor(hubUp, 60_000))) throw new Error("hub did not come up");

  // 1. join from both laptops; wire one folder per agent
  const loginA = on("laptop-a", `warren login ${JOIN} --name alice`);
  const loginB = on("laptop-b", `warren login ${JOIN} --name bob`);
  check(loginA.includes("as @alice") && loginB.includes("as @bob"), "both laptops join the team with the link");
  const addA = on("laptop-a", "mkdir -p /work/app && cd /work/app && warren add codex");
  const addB = on("laptop-b", "mkdir -p /work/app && cd /work/app && warren add claude");
  check(addA.includes("@codex-alice") && addB.includes("@claude-bob"), "each laptop wires its folder's agent (codex-alice, claude-bob)");
  const alice = JSON.parse(file("laptop-a", "/root/.warren/config.json")).token as string;

  bg("laptop-a", "cd /work/app && warren wake > /tmp/wake.log 2>&1");
  bg("laptop-b", "cd /work/app && fake-claude.mjs > /tmp/claude.log 2>&1");
  check(!!(await online(alice, "codex-alice")) && !!(await online(alice, "claude-bob")), "both agents are online from their own laptops");

  // 2. cross-device mention -> wake -> answer pushed back
  claudeCall("post", { room: "junction", kind: "question", text: "@codex-alice add a login page" });
  const woke = await waitFor(() => codexPrompts().find((p) => p.includes("add a login page")));
  check(!!woke && woke.includes("from @claude-bob"), "laptop-b's Claude mention wakes Codex on laptop-a");
  const answer = await waitFor(() => pushed().find((p) => p.content.includes("done: add a login page")));
  check(!!answer && answer.meta.from === "codex-alice" && answer.meta.kind === "done", "Codex's answer is pushed into Claude's session on laptop-b");

  // 3. other folders on the same laptop stay out
  const other = on("laptop-a", "mkdir -p /work/side-project && cd /work/side-project && warren status");
  const handles = (await members(alice)).map((m) => m.handle).sort();
  check(other.includes("no agent") && JSON.stringify(handles) === '["alice","bob","claude-bob","codex-alice"]', `an unwired folder isn't a member (members: ${handles})`);

  // 4. hub restart: state survives, bridges reconnect, delivery resumes
  compose("restart", "hub");
  findHub();
  await waitFor(hubUp, 60_000);
  const meAfter = await fetch(`${HUB}/api/me`, { headers: { Authorization: `Bearer ${alice}` } }).then((r) => r.json());
  const history = await fetch(`${HUB}/api/rooms/junction/messages`, { headers: { Authorization: `Bearer ${alice}` } }).then((r) => r.json());
  check(meAfter.handle === "alice" && history.length === 2, `after a hub restart tokens and messages survive (${history.length} messages)`);
  await online(alice, "codex-alice");
  await online(alice, "claude-bob");
  claudeCall("post", { room: "junction", kind: "question", text: "@codex-alice wire the signup form" });
  check(!!(await waitFor(() => pushed().find((p) => p.content.includes("done: wire the signup form")))), "after the restart a mention round-trips again");

  // 5. laptop-a drops off the venue network; a mention sent meanwhile is replayed once
  execFileSync("docker", ["network", "disconnect", NET, "warren-devices-laptop-a-1"]);
  await waitFor(async () => !(await members(alice)).find((m) => m.handle === "codex-alice")?.online, 30_000);
  claudeCall("post", { room: "junction", kind: "question", text: "@codex-alice fix the footer while you were away" });
  await sleep(1500);
  check(!codexPrompts().some((p) => p.includes("footer")), "a laptop without network gets nothing");
  execFileSync("docker", ["network", "connect", NET, "warren-devices-laptop-a-1"]);
  await waitFor(() => codexPrompts().some((p) => p.includes("footer")), 30_000);
  await sleep(1500);
  const footer = codexPrompts().filter((p) => p.includes("footer")).length;
  check(footer === 1, `back online, the missed mention is delivered exactly once (${footer}x)`);

  // 6. leave
  on("laptop-a", "pkill -f 'warren wake' || true");
  const leave = on("laptop-a", "cd /work/app && warren leave && ls -a && cat .codex/config.toml");
  const afterLeave = (await members(alice)).map((m) => m.handle);
  check(leave.includes("left") && !leave.includes("mcp_servers.warren") && !leave.includes(".warren.json") && !afterLeave.includes("codex-alice"), "warren leave removes codex-alice and cleans the folder");
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  if (process.env.KEEP !== "1") compose("down", "-v", "--remove-orphans");
}
process.exit(failed ? 1 : 0);
