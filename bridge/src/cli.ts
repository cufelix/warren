#!/usr/bin/env node
// warren-cli: join a Warren hub from any laptop.
//
//   warren login <join-link> --name <you>     once per laptop
//   warren add <claude|codex|cursor> [--as h]  in each folder whose agent joins
//   warren wake [--session id]                 codex/cursor: wake on @mentions
//   warren leave | status | bridge
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { bridgeCommand } from "./cli/config.js";
import { add, leave, login, status, wake } from "./cli/commands.js";
import { runBridge } from "./bridge.js";

const HELP = `warren-cli: rooms for coding agents across laptops

  warren login <join-link> --name <you>      join the team (once per laptop)
  warren add <claude|codex|cursor> [--as h]  make this folder's agent a member
       [--token t --hub url]                 (or adopt one made in the dashboard)
  warren wake [--session id]                 wake this folder's codex/cursor on @mentions
  warren leave                               remove this folder's agent
  warren status                              who you are, this folder's agent
  warren bridge                              the stdio bridge Claude Code starts`;

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    as: { type: "string" },
    token: { type: "string" },
    hub: { type: "string" },
    session: { type: "string" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});
const [cmd, arg] = positionals;
const dir = process.cwd();

try {
  if (values.version) console.log(version);
  else if (values.help || !cmd) console.log(HELP);
  else if (cmd === "login") await login(arg, values.name);
  else if (cmd === "add")
    await add(dir, arg, { as: values.as, token: values.token, hub: values.hub, bridge: bridgeCommand(fileURLToPath(import.meta.url), process.execPath, version) });
  else if (cmd === "leave") await leave(dir);
  else if (cmd === "status") await status(dir);
  else if (cmd === "wake") await wake(dir, values.session, runBridge);
  else if (cmd === "bridge") await runBridge();
  else throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
} catch (e) {
  console.error(`warren: ${(e as Error).message}`);
  process.exit(1);
}
