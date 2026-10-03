# Test report: VPS hub + KVM laptops + real Claude Code (2026-10-03)

## Setup

| Machine | What runs there |
|---|---|
| VPS (Hostinger, Ubuntu 24.04, public internet) | Hub in Docker, team mode, fresh DB per run (`e2e/vms/hub.sh`) |
| laptop-alice (KVM VM, Ubuntu 24.04, **clock +10 min**) | `warren-cli` from the packed tarball; Codex (stub) in `/work/api`, Cursor (stub) in `/work/web`, both woken by `warren wake` |
| laptop-bob (KVM VM, Ubuntu 24.04) | `warren-cli` from the packed tarball; Claude Code (fake host that starts the bridge from `.mcp.json`) in `/work/app` |
| laptop-felix (this machine) | **Real Claude Code** (Haiku 4.5, interactive, channels on) joined with `warren add claude`; dashboard in a real browser |

Rerun: `e2e/vms/up.sh alice:2221 bob:2222`, `e2e/vms/provision.sh <port> <tgz>` (+ `mcp-call.mjs`), `e2e/vms/hub.sh <ssh-host> <code> deploy`, then `HUB=... JOIN_CODE=... VPS=... npm run vms`.

## Automated matrix (`npm run vms`): 39/39 on the final build

```
PASS  hub on the VPS answers over the internet
PASS  join: a wrong code is refused; the join page shows the command
PASS  join: both laptops log in with the link
PASS  join: alice logging in on a second laptop gets the same identity
PASS  add codex: .codex/config.toml points at the VPS hub with a bearer header, token files gitignored
PASS  add cursor: .cursor/mcp.json and cli.json pre-approving warren tools
PASS  add claude: .mcp.json starts the bridge, CLAUDE.md has the standing instruction
PASS  add: a folder that is already wired is refused
PASS  add --as: a second Claude with its own handle
PASS  add --token: an agent made in the dashboard is adopted by a folder
PASS  status: identity, hub reachable, this folder's agent
PASS  status: a folder that wasn't added has no agent
PASS  delivery: codex-alice, cursor-alice (laptop-alice, clock +10 min) and claude-bob are online
PASS  wake cursor: created a chat and saved it in .warren.json
PASS  delivery: bob's Claude mention wakes Codex on laptop-alice
PASS  delivery: Codex's answer is pushed into bob's Claude session
PASS  delivery: a Cursor mention resumes the saved chat on laptop-alice
PASS  delivery: Cursor's answer reaches bob's Claude
PASS  delivery: an untagged note wakes nobody
PASS  delivery: @room reaches both agents on laptop-alice
PASS  delivery: an agent without a bridge pulls its mention from the inbox
PASS  MCP over HTTP from laptop-alice: whoami as codex-alice
PASS  claims: bob's Claude can't lock a file codex-alice holds, and is told who
PASS  claims: after release the other laptop gets the lock
PASS  rooms: a subroom made on laptop-alice is readable from laptop-bob
PASS  safety: a pasted API key is masked before it reaches the other laptop
PASS  safety: a paused agent isn't woken
PASS  safety: after resume it's woken again
PASS  safety: an agent's contract change waits for its person's approval, then goes out
PASS  safety: agents talking without a person get held after 8 messages
PASS  A2A: agent card names the VPS url; message/send from laptop-alice posts
PASS  hub restart on the VPS: 15 messages kept, bridges on both laptops reconnect
PASS  hub restart: a mention round-trips again
PASS  network drop: laptop-alice (clock +10 min) gets the missed mention exactly once after reconnecting (1x)
PASS  dead Wi-Fi: the bridge notices the silence, reconnects and delivers the mention once (1x)
PASS  hub down for 20 s: bridges keep retrying and come back by themselves
PASS  removed agent: cursor-alice's wake bridge stops by itself (codex's keeps running)
PASS  leave with the hub down: refused, the folder keeps its token to retry
PASS  leave: agents removed from the hub, .mcp.json cleaned, CLAUDE.md (made by warren) deleted
```

## Real Claude Code + dashboard (manual, driven over tmux and Playwright)

| Test | Result |
|---|---|
| VM agent (claude-bob) asks the real Claude a question, nobody types | 1st try: real Claude answered **in its own terminal**, not in the room (FAIL). Fixed in this run: the pushed text now says how to answer and that a reply in the session isn't seen. After the fix **3/3** answers posted to the room and reached laptop-bob |
| Real Claude (told by its human) delegates to codex-alice on laptop-alice | PASS: Codex woken on the VM; its reply was held by the loop guard (see findings), released by @felix in one click, then pushed into the real Claude session |
| Dashboard on the VPS URL | PASS: all agents from three machines with presence, thread, safety log, "Released by @felix" |
| Dashboard composer -> @claude-felix | PASS: real Claude's answer appears live, highlighted as "for you" |
| Dashboard "Add agent" | PASS: command uses the VPS address; `warren add claude --hub --token` on laptop-bob, agent online |
| Dashboard remove (X + confirm) | PASS: member gone; its bridge on laptop-bob logs 401 and stops listening |

## Bugs found and fixed in this run

1. **Dead Wi-Fi hangs the bridge** (bce6f11). A connection that silently stops delivering left the bridge waiting forever. It now reconnects after 45 s without data (the hub pings every 15 s) and replays by message id. Verified on the VM by dropping all packets from the VPS for 60 s.
2. **Removing an agent didn't reach its bridge** (bce6f11). The hub now ends the removed member's event stream; the bridge reconnects, gets 401 and stops.
3. **Real Claude answered in its terminal instead of the room**. Each pushed message now ends with how to answer (`post` tool, room, sender) and that a reply in the session isn't seen.

## Findings that need a decision

- **Loop guard fires during normal teamwork.** After 8 agent messages with no person in between, the next one is held. It blocked legit work twice in real use, and it did catch a real ack ping-pong (Claude "Thanks!" / Codex "done" / Claude 👍 ...). Options: a higher limit for team hubs (`WARREN_LOOP_LIMIT`), or only count short back-and-forth between the same two agents.
- **Dashboard doesn't render markdown**: `**Port 443**` shows raw asterisks.
- **Presence can lag on a dead network**: with QEMU user networking the hub kept showing laptop-alice online for 60 s with its cable out. Delivery is unaffected (replay by id), but the online dot can lie for a while.
