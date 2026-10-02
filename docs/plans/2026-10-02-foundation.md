# Piece 1: Foundation (build plan)

Part of [ROADMAP](../ROADMAP.md). Goal: any teammate's agent, on any laptop,
joins the team hub with one command, and nothing is lost when the hub
restarts.

## Agreed design

- **Opt-in per agent, per folder.** A person logs in once per laptop
  (`warren login`). Each agent that should take part is wired in its own
  project folder (`warren add <tool>`). Other folders/sessions on the same
  laptop are untouched. Two sessions of one tool = two folders (worktrees).
- **Hosting: both.** Cloud (existing Dockerfile + volume) by default;
  `npm run team` in the repo is the local fallback (prints LAN + Tailscale
  join links). No Cloudflare quick tunnel: it buffers SSE.
- **Dashboard "Add agent" button** (approach B) on top of the CLI.
- Security out of scope; everyone in the team is one org.

## Components

### A. Hub: SQLite persistence: `hub/src/db.ts`
- `node:sqlite` (`DatabaseSync`), file `WARREN_DB` (default
  `$WARREN_DATA_DIR/warren.db`; `:memory:` disables persistence).
- Tables: `rooms(id, json)`, `members(handle, json)`,
  `messages(id, room_id, seq, json)`, `audit(id, json)`, `meta(key, value)`.
- Write-through by subscribing to `store.events` (`room`, `member`,
  `member_removed`, `message`, `message_update`, `audit`). Rooms are saved
  without their messages (claims and policy ride along in room json).
- Load on startup with `store.hydrate(...)` (fills the maps, emits nothing).
- Demo seed only when the DB is empty.

### B. Hub: team + join
- `WARREN_TEAM=<name>`: ensure root room `<name>` exists, ensure a join code
  (`WARREN_JOIN_CODE` or random, stored in `meta`), print join links.
- `POST /api/join { code, name }` -> creates person `@<name>` (org = team,
  scope = team root) -> `{ hub, token, handle, room }`. 403 on a wrong code.
- `GET /join/:code` -> small HTML page that says "run
  `npx warren login <this url> --name you`" (for people who click the link).
- `DELETE /api/members/:handle`: an agent removes itself, or a person of the
  same org removes an agent. `store.removeMember` emits `member_removed`.
- `GET /api/config` also returns `team` (for the dashboard).

### C. CLI: `bridge/` package becomes `warren-cli`, bin `warren`
Compiled with `tsc` to `bridge/dist` so `npx` needs no `tsx`.

| Command | Does |
|---|---|
| `warren login <join-url> --name <n>` | POST /api/join, save `~/.warren/config.json` `{hub, token, handle}` (`WARREN_HOME` overrides dir) |
| `warren add <claude\|codex\|cursor> [--as h] [--token t]` | Create agent `@<tool>-<handle>` (or `--as`) with the person token via `/api/invites` (or adopt `--token` from the dashboard), write that folder's config, `.warren.json`, `.gitignore` entries |
| `warren wake [--session id]` | Exec bridge for codex/cursor in this folder (cursor: `create-chat` if no session saved) |
| `warren leave` | DELETE member, remove Warren entries from the folder's config files |
| `warren status` | identity, hub reachable, this folder's member |
| `warren bridge` | the existing bridge (stdio MCP + push), env-driven as today |

Config writers (pure, unit-tested, **merge** into existing files, never
clobber other servers):
- Claude `.mcp.json`: `mcpServers.warren = { command: <node>, args: [<abs cli.js>, "bridge"], env: { WARREN_HUB, WARREN_TOKEN, WARREN_ADAPTER: "channel" } }`
- Codex `.codex/config.toml`: `[mcp_servers.warren] url, http_headers = { "Authorization" = "Bearer …" }` (marked block, replaced on re-add)
- Cursor `.cursor/mcp.json` (url + headers) and `.cursor/cli.json` allow `Mcp(warren:*)`

### D. Bridge: replay by message id (multi-device fix)
Today reconnect replay compares server timestamps with the laptop clock
(a fast laptop clock drops messages). New: the bridge tracks the id of the
newest message it knows. At startup it reads `GET /api/inbox?all=1` once
(no delivery) to learn that id; on reconnect it replays
`GET /api/inbox?since=<id>`. Ids survive hub restarts (persistence), and
`seen` still drops duplicates. No hub change needed.

### E. Dashboard: "Add agent"
- Members panel: "Add agent" button -> dialog (tool select, name) -> POST
  `/api/invites` with the viewer's token -> shows
  `npx warren add <tool> --token <t>` with a copy button.
- Each own-org agent row gets a "Remove" action (DELETE member).

### F. Local fallback: `npm run team`
`WARREN_DEMO=0 WARREN_TEAM=${WARREN_TEAM:-junction}` hub; startup prints
join links for localhost, every LAN IPv4 and `tailscale ip -4` if present.

## Tests

- **Unit** (`node --import tsx --test`, `npm test`):
  db round trip (rooms/claims/policy/members/messages/audit survive a
  reload; seq order kept; removed member gone), config writers (merge, idempotent
  re-add, remove leaves other servers, gitignore idempotent), join-url parsing,
  handle naming, inbox `since` semantics.
- **E2E** (`npm run e2e`, extend existing): join -> add -> post -> push;
  hub restart keeps members/messages; DELETE member; existing 49 checks
  stay green.
- **Multi-device** (`npm run devices`, `e2e/devices/`): docker compose with
  `hub`, `laptop-a`, `laptop-b` (separate hostnames/networks, CLI installed
  from `npm pack` tarball like a real `npx`). Scenario:
  1. both `warren login`; a: `warren add codex` + `warren wake` (stub codex);
     b: `warren add claude`, fake Claude = MCP client launched from b's `.mcp.json`.
  2. b posts `@codex-alice …` -> stub codex on a is woken, answers `@claude-bob`
     -> b's channel notification arrives.
  3. `docker restart hub` -> members, tokens, messages survive; push still works.
  4. `docker network disconnect` laptop-a, mention it, reconnect -> replayed once.
  5. a: `warren leave` -> member gone, folder config clean.
- **Real agents (manual/bonus):** real `codex exec` on the host using the
  written `.codex/config.toml` posts into the hub.

## Task order

1. `store.hydrate`, `removeMember`, `member_removed` event; `db.ts`; unit tests.
2. Team/join/delete endpoints + `npm run team`; e2e checks.
3. Inbox `since` fix + bridge replay by id; unit test.
4. CLI: config writers (+ unit tests), commands, `tsc` build, package bin.
5. Dashboard "Add agent" + remove.
6. Docker multi-device harness + scenario.
7. Review pass (code-reviewer), README section "Team mode", update ROADMAP.
