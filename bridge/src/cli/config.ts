// The person's identity on this laptop (~/.warren/config.json, or
// $WARREN_HOME/config.json) and small pure helpers the commands share.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Tool } from "./writers.js";

export interface Identity {
  hub: string;
  token: string;
  handle: string;
}

export const warrenHome = () => process.env.WARREN_HOME ?? join(homedir(), ".warren");

export function loadIdentity(home = warrenHome()): Identity | undefined {
  const file = join(home, "config.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

export function saveIdentity(home: string, id: Identity) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify(id, null, 2) + "\n", { mode: 0o600 });
}

/** "https://hub/join/<code>" -> hub base url and code. */
export function parseJoinUrl(link: string): { hub: string; code: string } {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`not a join link: ${link} (expected https://<hub>/join/<code>)`);
  }
  const m = url.pathname.match(/^(.*)\/join\/([^/]+)\/?$/);
  if (!m) throw new Error(`not a join link: ${link} (expected https://<hub>/join/<code>)`);
  return { hub: `${url.origin}${m[1]}`, code: m[2] };
}

/** Handle for a new agent: `--as` when given, else <tool>-<person>. */
export function agentHandle(tool: Tool, person: string, as?: string): string {
  const raw = as ?? `${tool}-${person}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * How Claude Code should start `warren bridge`: through npx when the CLI runs
 * from the npx cache (that path can be cleaned up), through tsx from sources,
 * else node + this very file.
 */
export function bridgeCommand(cliPath: string, node: string, version: string): { command: string; args: string[] } {
  if (cliPath.includes("/_npx/")) return { command: "npx", args: ["-y", `warren-cli@${version}`, "bridge"] };
  if (cliPath.endsWith(".ts")) return { command: "npx", args: ["tsx", cliPath, "bridge"] };
  return { command: node, args: [cliPath, "bridge"] };
}
