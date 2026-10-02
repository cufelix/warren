// Wires one project folder's agent to Warren by editing that folder's own
// tool config, and unwires it again. Other MCP servers and settings in those
// files are kept; only Warren's entries are added or removed.
//
//   claude  .mcp.json            stdio server: warren bridge, channel push
//   codex   .codex/config.toml   streamable HTTP server with a bearer header
//   cursor  .cursor/mcp.json     streamable HTTP server; .cursor/cli.json
//                                pre-approves Mcp(warren:*) for headless turns
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const TOOLS = ["claude", "codex", "cursor"] as const;
export type Tool = (typeof TOOLS)[number];

export interface Wiring {
  tool: Tool;
  hub: string;
  token: string;
  handle: string;
  bridge: { command: string; args: string[] }; // how Claude Code starts `warren bridge`
  session?: string; // exec wake-up session (codex/cursor)
}

/** What a folder's .warren.json holds: which member this folder's agent is. */
export type FolderMember = Omit<Wiring, "bridge">;

export const FOLDER_FILE = ".warren.json";
const CODEX_FILE = ".codex/config.toml";
const BEGIN = "# >>> warren (managed by warren-cli, `warren leave` removes it)";
const END = "# <<< warren";

/** Files that hold this tool's token: they belong in .gitignore. */
export function tokenFiles(tool: Tool): string[] {
  return [FOLDER_FILE, ...{ claude: [".mcp.json"], codex: [CODEX_FILE], cursor: [".cursor/mcp.json"] }[tool]];
}

export function wireFolder(dir: string, w: Wiring) {
  if (w.tool === "claude") {
    editJson(join(dir, ".mcp.json"), (cfg) => ({
      ...cfg,
      mcpServers: {
        ...(cfg.mcpServers as object),
        warren: { ...w.bridge, env: { WARREN_HUB: w.hub, WARREN_TOKEN: w.token, WARREN_ADAPTER: "channel" } },
      },
    }));
  } else if (w.tool === "codex") {
    const file = join(dir, CODEX_FILE);
    const rest = stripBlock(readText(file));
    if (/^\s*\[mcp_servers\.warren\]/m.test(rest))
      throw new Error(`${CODEX_FILE} already has [mcp_servers.warren] that warren-cli didn't write; remove it first`);
    const block = [BEGIN, "[mcp_servers.warren]", `url = ${tomlString(`${w.hub}/mcp`)}`, `http_headers = { "Authorization" = ${tomlString(`Bearer ${w.token}`)} }`, END];
    writeText(file, (rest && !rest.endsWith("\n") ? rest + "\n" : rest) + block.join("\n") + "\n");
  } else {
    editJson(join(dir, ".cursor/mcp.json"), (cfg) => ({
      ...cfg,
      mcpServers: { ...(cfg.mcpServers as object), warren: { url: `${w.hub}/mcp`, headers: { Authorization: `Bearer ${w.token}` } } },
    }));
    editJson(join(dir, ".cursor/cli.json"), (cfg) => {
      const perms = (cfg.permissions ?? {}) as { allow?: string[]; deny?: string[] };
      const allow = perms.allow ?? [];
      return { ...cfg, permissions: { ...perms, allow: allow.includes("Mcp(warren:*)") ? allow : [...allow, "Mcp(warren:*)"], deny: perms.deny ?? [] } };
    });
  }
  const { bridge: _b, ...member } = w;
  writeText(join(dir, FOLDER_FILE), JSON.stringify(member, null, 2) + "\n");
}

export function unwireFolder(dir: string, tool: Tool) {
  const dropWarren = (cfg: Record<string, unknown>) => {
    const { warren: _w, ...others } = (cfg.mcpServers ?? {}) as Record<string, unknown>;
    return { ...cfg, mcpServers: others };
  };
  if (tool === "claude") editJson(join(dir, ".mcp.json"), dropWarren, false);
  else if (tool === "codex") {
    const file = join(dir, CODEX_FILE);
    if (existsSync(file)) writeText(file, stripBlock(readText(file)));
  } else {
    editJson(join(dir, ".cursor/mcp.json"), dropWarren, false);
    editJson(
      join(dir, ".cursor/cli.json"),
      (cfg) => {
        const perms = (cfg.permissions ?? {}) as { allow?: string[] };
        return { ...cfg, permissions: { ...perms, allow: (perms.allow ?? []).filter((p) => p !== "Mcp(warren:*)") } };
      },
      false,
    );
  }
  rmSync(join(dir, FOLDER_FILE), { force: true });
}

export function readFolder(dir: string): FolderMember | undefined {
  const file = join(dir, FOLDER_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

export function writeFolder(dir: string, member: FolderMember) {
  writeText(join(dir, FOLDER_FILE), JSON.stringify(member, null, 2) + "\n");
}

/** Appends entries that aren't in .gitignore yet. */
export function addGitignore(dir: string, entries: string[]) {
  const file = join(dir, ".gitignore");
  const text = readText(file);
  const have = new Set(text.split("\n").map((l) => l.trim()));
  const missing = entries.filter((e) => !have.has(e));
  if (!missing.length) return;
  writeText(file, (text && !text.endsWith("\n") ? text + "\n" : text) + ["# warren (tokens)", ...missing].join("\n") + "\n");
}

// --- helpers -------------------------------------------------------------------

function readText(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function writeText(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Read-modify-write a JSON file. With `create` false, a missing file stays missing. */
function editJson(file: string, edit: (cfg: Record<string, unknown>) => Record<string, unknown>, create = true) {
  if (!create && !existsSync(file)) return;
  const text = readText(file).trim();
  writeText(file, JSON.stringify(edit(text ? JSON.parse(text) : {}), null, 2) + "\n");
}

function stripBlock(text: string): string {
  const start = text.indexOf(BEGIN);
  if (start === -1) return text;
  const end = text.indexOf(END, start);
  return text.slice(0, start) + (end === -1 ? "" : text.slice(end + END.length).replace(/^\n/, ""));
}

function tomlString(s: string): string {
  return JSON.stringify(s); // TOML basic strings use the same escapes as JSON for our input
}
