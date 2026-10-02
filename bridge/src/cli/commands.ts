// warren-cli commands. Each one talks to the hub over its REST API and edits
// only the current folder (and ~/.warren for the person's identity).
import { execFileSync } from "node:child_process";
import { loadIdentity, saveIdentity, warrenHome, parseJoinUrl, agentHandle, type Identity } from "./config.js";
import { TOOLS, addGitignore, readFolder, tokenFiles, unwireFolder, wireFolder, writeFolder, type Tool, type Wiring } from "./writers.js";

interface Member {
  handle: string;
  kind: string;
  org: string;
  scopeRoomId: string;
  token?: string;
}

async function hubCall<T>(hub: string, path: string, opts: { token?: string; method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${hub}${path}`, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error(`can't reach the hub at ${hub} (${(e as Error).message})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `hub answered ${res.status}`);
  return data as T;
}

const requireIdentity = (): Identity => {
  const id = loadIdentity();
  if (!id) throw new Error("not logged in: run `warren login <join-link> --name <you>` first");
  return id;
};

const asTool = (t: string | undefined): Tool => {
  if (!TOOLS.includes(t as Tool)) throw new Error(`tool must be one of ${TOOLS.join(", ")}`);
  return t as Tool;
};

export async function login(link: string | undefined, name: string | undefined) {
  if (!link) throw new Error("usage: warren login <join-link> --name <you>");
  if (!name) throw new Error("pass --name <you>: your @handle in the team");
  const { hub, code } = parseJoinUrl(link);
  const joined = await hubCall<{ handle: string; token: string; team: string }>(hub, "/api/join", { body: { code, name } });
  saveIdentity(warrenHome(), { hub, token: joined.token, handle: joined.handle });
  console.log(`Joined team "${joined.team}" as @${joined.handle}.`);
  console.log(`Dashboard: ${hub}/app?token=${joined.token}`);
  console.log(`Next, in a project folder whose agent should join: warren add claude   (or codex, cursor)`);
}

export async function add(dir: string, toolArg: string | undefined, opts: { as?: string; token?: string; hub?: string; bridge: Wiring["bridge"] }) {
  const tool = asTool(toolArg);
  const existing = readFolder(dir);
  if (existing && !opts.token) throw new Error(`this folder is already @${existing.handle} (${existing.tool}); run \`warren leave\` first`);

  let hub: string;
  let agent: Member & { token: string };
  if (opts.token) {
    // From the dashboard's "Add agent": the member already exists.
    hub = opts.hub ?? requireIdentity().hub;
    agent = { ...(await hubCall<Member>(hub, "/api/me", { token: opts.token })), token: opts.token };
  } else {
    const id = requireIdentity();
    hub = id.hub;
    const me = await hubCall<Member>(hub, "/api/me", { token: id.token });
    const wanted = agentHandle(tool, id.handle, opts.as);
    agent = await hubCall<Member & { token: string }>(hub, "/api/invites", {
      token: id.token,
      // Without --as the hub picks a free handle (claude-felix-2 for a second Claude).
      body: { ...(opts.as ? { handle: wanted } : {}), name: wanted, kind: "agent", org: me.org, room: me.scopeRoomId, adapter: tool === "claude" ? "channel" : "exec" },
    });
  }

  if (existing) unwireFolder(dir, existing.tool); // --token over a wired folder: replace, don't stack
  try {
    wireFolder(dir, { tool, hub, token: agent.token, handle: agent.handle, bridge: opts.bridge });
  } catch (e) {
    // Don't leave a member behind that no folder holds the token of.
    if (!opts.token) await hubCall(hub, `/api/members/${agent.handle}`, { token: agent.token, method: "DELETE" }).catch(() => {});
    throw e;
  }
  addGitignore(dir, tokenFiles(tool));
  console.log(`This folder's ${tool} is now @${agent.handle}.`);
  if (tool === "claude") console.log("Start Claude Code here with:\n  claude --dangerously-load-development-channels server:warren");
  if (tool === "codex") console.log("Start Codex here (trust the folder so it loads .codex/config.toml), then in a second terminal:\n  warren wake");
  if (tool === "cursor") console.log("Cursor reads .cursor/mcp.json here. To have mentions wake cursor-agent, run:\n  warren wake");
}

export async function leave(dir: string) {
  const f = readFolder(dir);
  if (!f) throw new Error("this folder has no warren agent");
  try {
    await hubCall(f.hub, `/api/members/${f.handle}`, { token: f.token, method: "DELETE" });
  } catch (e) {
    const msg = (e as Error).message;
    // Unreachable hub: keep the token so `warren leave` can be retried. Unknown token: already gone.
    if (msg.startsWith("can't reach")) throw new Error(`${msg}; nothing changed, try again when the hub is back`);
    console.error(`note: hub says ${msg}; cleaning the folder.`);
  }
  unwireFolder(dir, f.tool);
  console.log(`@${f.handle} left; this folder's ${f.tool} config no longer mentions warren.`);
}

export async function status(dir: string) {
  const id = loadIdentity();
  const f = readFolder(dir);
  if (!id && !f) return void console.log("Not logged in. Run `warren login <join-link> --name <you>`.");
  if (id) {
    const me = await hubCall<Member>(id.hub, "/api/me", { token: id.token }).then(
      (m) => `@${m.handle} in ${m.scopeRoomId} (hub reachable)`,
      (e: Error) => `@${id.handle}, but ${e.message}`,
    );
    console.log(`You:         ${me}\nHub:         ${id.hub}`);
  }
  if (!f) return void console.log("This folder: no agent (warren add <claude|codex|cursor>)");
  const agent = await hubCall<Member & { online: boolean }>(f.hub, "/api/me", { token: f.token }).then(
    (m) => `@${m.handle} (${f.tool}, ${m.online ? "online" : "offline"})`,
    (e: Error) => `@${f.handle} (${f.tool}), but ${e.message}`,
  );
  console.log(`This folder: ${agent}`);
}

/** Runs an exec bridge for this folder's codex or cursor until Ctrl+C. */
export async function wake(dir: string, session: string | undefined, runBridge: () => Promise<unknown>) {
  const f = readFolder(dir);
  if (!f) throw new Error("this folder has no warren agent: run `warren add codex` (or cursor) first");
  if (f.tool === "claude") throw new Error("Claude Code gets mentions pushed through its channel; no wake needed");
  let s = session ?? f.session;
  if (!s && f.tool === "cursor") {
    s = execFileSync(process.env.WARREN_EXEC_CMD ?? "cursor-agent", ["create-chat"], { cwd: dir, encoding: "utf8" }).trim();
    console.error(`created cursor chat ${s}`);
  }
  if (s && s !== f.session) writeFolder(dir, { ...f, session: s });
  if (!s) console.error("no --session given: codex resumes its most recent session (`codex exec resume --last`)");
  Object.assign(process.env, {
    WARREN_HUB: f.hub,
    WARREN_TOKEN: f.token,
    WARREN_ADAPTER: "exec",
    WARREN_EXEC_CLIENT: f.tool,
    WARREN_STDIO: "0",
    ...(s ? { WARREN_EXEC_SESSION: s } : {}),
  });
  process.chdir(dir); // the agent resumes in its own project folder
  await runBridge();
}
