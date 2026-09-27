---
description: Quick reference for the token-economy plugin — components, commands, options
disable-model-invocation: true
---

Show the token-economy quick reference below. One shot, change nothing: do not
edit files or persist state.

**Principle: locate, don't read.** Every tool result stays in context for the
rest of the session. Search finds the location; Read is a slice (`offset`/`limit`)
taken to act.

**Components**
- `read-guard` (PreToolUse, Read) — denies whole-file Reads estimated over the
  token budget (default 10,000). A Read with `limit` up to 600 lines always passes.
  The deny carries an outline (headings or declarations with line numbers) to aim
  the slice. Fail-open on any hook error.
- `explore-router` (PreToolUse, Agent) — an Explore subagent launched without a
  model runs on a cheaper one (default `haiku`) and reports `path:line` conclusions.
- `session-start` (SessionStart) — injects the exploration policy and, in
  projects with `.grepai/config.yaml`, starts `grepai watch` in the background.
- `exploring-codebase` (skill) — which tool for which question, when a direct
  Read is right, when to delegate to Explore.

**Commands**
- `/context-audit` — input-token bloat the guard would remove on this repo (ceiling).
- `/economy-stats` — savings actually logged at deny time, this project and all.
- `/economy-help` — this card.

**Options** (`/config`, plugin options)
- `read_budget` — the Read budget in tokens (default 10000, min 2000).
- `inject_policy` — policy at session start (default on).
- `grepai_autostart` — start `grepai watch` (default on; legacy env `GREPAI_WATCH_AUTOSTART=0`).
  The daemon keeps running after the session; stop it with `grepai watch --stop`.
- `explore_model` — `haiku`, `sonnet`, `opus`, `fable`, or `inherit` to keep the main model.

**Turn it off**: set the option above, or `/plugin disable token-economy@token-economy`
for the whole plugin. Deny telemetry stays local in the plugin data directory and
is removed on uninstall.
