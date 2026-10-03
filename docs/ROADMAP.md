# Warren for Junction 2026: roadmap

Junction 2026: Nov 13-15, Espoo. 48 hours, teams of up to 5.

## Goal

Warren is our team's own tool during the hackathon, not our submission.
3-5 people, each on their own laptop, running mostly Claude Code, Codex and
Cursor (sometimes local models). Warren should let every laptop's agents
work as one team, and make the 48 hours faster and more fun.

Security is out of scope for now (known holes: invite org spoofing and
unreviewed `set_context`, see "Known issues").

**Done means:** every teammate joins with one command, work is split without
duplicate effort, and we actually enjoy watching it.

## Pieces, in build order

Each piece gets its own design (spec), plan and implementation.

| # | Piece | Builds on | Target |
|---|---|---|---|
| 1 | Foundation: one-command join + SQLite persistence (**built, branch feat/foundation**) | - | week 1 (Oct 5-11) |
| 2 | Bounty board + leaderboard | claims, 1 | week 1-2 |
| 3 | Review duel + model council | mentions, 2 ("done") | week 2-3 |
| 4 | Mission control: hackathon clock, phone push, night shift digest | 2, 3 | week 3 |
| 5 | Burrow view: live visualization of every agent on every laptop | hooks, 1-4 | week 4 |
| - | Practice mini-hackathon (6-8 h on a past challenge) | all | week 5 (by Nov 8) |

### 1. Foundation
- `npx warren-join <invite-link>`: publishable bridge package, no repo clone.
  Detects Claude Code / Codex / Cursor and writes their MCP config.
- State in SQLite (built-in `node:sqlite`, no native deps) so a hub restart
  at hour 30 loses nothing.
- Hub reachable from every laptop (see research notes: hosting).

### 2. Bounty board + leaderboard
- Tasks with points, status (open / claimed / review / done), optional deps.
- Agents and people claim tasks (extends existing `claim` with file locks).
- Live scoreboard per member and per vendor; achievements
  (first green build, night owl, merge-conflict survivor, ...).

### 3. Review duel + model council
- On `done`, Warren tags an agent of a different vendor to review the work.
- `@council <question>`: fan out to one agent per vendor, answers side by
  side, people vote.

### 4. Mission control
- Hackathon clock: phases announced `@room` (feature freeze h24, pitch
  rehearsal h40); current phase injected into agent instructions.
- Phone push (Telegram or ntfy) when a person is mentioned or blocking;
  reply from phone.
- Night shift: agents keep pulling bounties while people sleep; morning
  digest "while you slept".

### 5. Burrow view
- Rooms are burrows, members are rabbits; live status (editing file X,
  running tests, waiting for a person, idle), laptop name, current task.
- Status comes from each tool's hooks posting to the hub.

## Research notes (2026-10-02)

- **Landscape.** Pixel-office visualizers (Pixel Agents, AgentOffice, Hermes
  Pixel Office) and swarm frameworks (ClawTeam, ruflo, claude-swarm,
  Claude Code agent teams) exist. Almost none handle agents on different
  laptops owned by different people in one shared space: Warren's niche.
- **Hosting.** Cloudflare *quick* tunnels buffer GET responses, so SSE
  (which Warren depends on) doesn't work through them. Options: a Tailscale
  tailnet for the team (installed here already), or the existing Dockerfile
  on a small cloud VM. Venue Wi-Fi behavior is unknown; don't depend on LAN.
- **Hooks for burrow view.** All three tools have hooks:
  - Claude Code: ~30 events (PreToolUse, PostToolUse, Stop, Notification,
    SubagentStart, ...); `http` hook type can POST straight to the hub.
  - Codex CLI: `[[hooks.PreToolUse]]` / `[[hooks.PostToolUse]]` in
    `.codex/config.toml` (command type, `async = true` supported).
  - Cursor: `.cursor/hooks.json` (beforeShellExecution, afterFileEdit,
    stop, ...), JSON on stdin.
- **Persistence.** `node:sqlite` works on Node 22 (experimental warning).

## Known issues (deferred)

- Any token can invite a member with any `kind` and `org` (defeats
  cross-org review).
- `set_context` skips secret masking and injection checks.
- Bridge replay after reconnect compares server timestamps with the local
  clock; a fast laptop clock drops messages. Should replay by message id.
- Setup snippets use a repo-relative bridge path (fixed by piece 1).

Sources: 2026.hackjunction.com, code.claude.com/docs/en/hooks,
developers.openai.com/codex/hooks, cursor hooks guides,
flaviocopes.com/cloudflare-quick-tunnels.
