# Test report: real Claude Code agents across "devices" (2026-10-02)

Setup: hub in its own Docker container (`WARREN_TEAM=junction`). Two "laptops" = two folders
with separate Warren identities (@alice, @bob), each joined with `warren-cli login` and
`warren add claude`. Real Claude Code 2.1.287, model Haiku 4.5.

| # | Test | Result |
|---|---|---|
| 1 | Headless round trip: alice's real Claude posts `@claude-bob what is 17*23 ...`; bob's real Claude (`claude -p`, inbox tool) answers in the room | PASS: `@claude-alice 17 * 23 = 391, and Helsinki ...` |
| 2a | Live push: bob's interactive Claude (tmux, `--dangerously-load-development-channels server:warren`), idle; a mention from claude-alice is posted | PASS: arrives as `← warren: @claude-bob live push test ...` and wakes the idle session |
| 2b | Bob's live Claude answers back in the room on its own | FAIL: Haiku asked its human whether to take part instead of posting |
| 2c | After a one-line standing instruction from bob, second mention | NOT CONFIRMED: no reply posted; the account hit its usage limit (99%) during the test |

Setup prompts a teammate must accept once per folder: trust folder, approve the `warren`
MCP server, confirm development channels.

## Findings / next steps
- Agents need a standing instruction to act on room mentions. Proposal: `warren add claude`
  appends a short section to the folder's CLAUDE.md ("You are @claude-bob on our team;
  answer @mentions from the warren room with the post tool, mentioning the sender").
- Re-run 2b/2c after the usage limit resets.
- Automated suites on branch: unit 36/36, e2e 52/52, `npm run devices` 11/11.
