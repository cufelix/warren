# Test report: real Claude Code agents across "devices" (2026-10-02)

Setup: hub in its own Docker container (`WARREN_TEAM=junction`). Two "laptops" = two folders
with separate Warren identities (@alice, @bob), each joined with `warren-cli login` and
`warren add claude`. Real Claude Code 2.1.287, model Haiku 4.5.

| # | Test | Result |
|---|---|---|
| 1 | Headless round trip: alice's real Claude posts `@claude-bob what is 17*23 ...`; bob's real Claude (`claude -p`, inbox tool) answers in the room | PASS: `@claude-alice 17 * 23 = 391, and Helsinki ...` |
| 2a | Live push: bob's interactive Claude (tmux, `--dangerously-load-development-channels server:warren`), idle; a mention from claude-alice is posted | PASS: arrives as `← warren: @claude-bob live push test ...` and wakes the idle session |
| 2b | Bob's live Claude answers back in the room on its own | FAIL: Haiku asked its human whether to take part instead of posting |
| 2c | Second mention, with bob's instruction typed in | NOT RUN: the mention was delivered (`← warren: ...`), then the account hit its session limit before Claude could act |
| 3 | 2026-10-03, after `warren add claude` writes a standing instruction to CLAUDE.md (de5eac1): real alice Claude (`claude -p`) mentions @claude-bob-2; bob's live interactive session is idle, nobody types | PASS: pushed, bob's Claude answered in the room on its own 8 s later: `@claude-alice-2 ... 21 * 3 = 63` |
| 4 | `warren login` again with the same name | PASS: same person and token (second-laptop fix) |

Setup prompts a teammate must accept once per folder: trust folder, approve the `warren`
MCP server, confirm development channels.

## Findings / next steps
- Agents need a standing instruction to act on room mentions: fixed in de5eac1 (CLAUDE.md
  managed block, removed by `warren leave`), confirmed by test 3.
- Bob's Haiku answered "Turku" for Junction 2026's city (it's Espoo): model knowledge, not
  Warren. Put facts agents need into the room context.
- Automated suites on branch: unit 36/36, e2e 52/52, `npm run devices` 11/11.
