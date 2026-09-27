# CLAUDE.md

Guide for working **on** this repo. The tool-usage policy the plugin injects at
runtime is not repeated here: this file is about developing the plugin.

## Overview

`token-economy-kit` is a Claude Code plugin (marketplace `dani-lore/token-economy-kit`,
plugin `token-economy`, version in `.claude-plugin/plugin.json`) that cuts **input-side**
context bloat: it denies whole-file Reads over a token budget, routes the Explore subagent to a
cheaper model, injects an exploration policy at session start, and ships a skill and commands.

Plain Node ESM, **zero dependencies**: no `node_modules`, no build step, no linter.

## Commands

```
npm test                                  # node --test "tests/*.test.mjs"
npm run bench                             # node benchmarks/score.mjs --out → benchmarks/results/<date>.md (gitignored)
node benchmarks/score.mjs --dir <path>    # bench on any directory, stdout only
claude plugin validate .                  # manifest + marketplace schema check
```

The glob in `npm test` is expanded by Node's test runner: it needs Node 21+ (CI uses 22).
CI: `.github/workflows/test.yml`, ubuntu + windows matrix.

To try the plugin locally, inside a Claude Code session:

```
/plugin marketplace add C:\path\to\token-economy-kit
/plugin install token-economy@token-economy
```

## Architecture

`hooks/hooks.json` registers three hooks, paths via `${CLAUDE_PLUGIN_ROOT}`:

- **PreToolUse** `Read` → `hooks/read-guard.mjs`. Denies a Read without `limit` ≤ 600 when the tokens
  estimated from the size (`ceil(bytes/4)`) exceed `READ_BUDGET`; the message carries an outline
  (headings or column-0 declarations) read from a 2 MB prefix. Skips extensions in `SKIP_EXTS`.
- **PreToolUse** `Agent|Task` → `hooks/explore-router.mjs`. Adds `model` and a report contract to
  Explore calls without `model`, via `permissionDecision: "allow"` + `updatedInput`.
- **SessionStart** → `hooks/session-start.mjs`. Policy in `additionalContext`, adapted to whether
  `.grepai/config.yaml` exists at or above the cwd; on `source` `startup`/`resume` it starts
  `grepai watch --background` and announces it in `systemMessage`.

`hooks/limits.mjs` is the **single source** of thresholds and of the cost model (budget, slice, native
Read caps, `logDir()`): read-guard, session-start, `benchmarks/score.mjs` and `scripts/economy-stats.mjs`
import it. `hooks/stdin.mjs` parses the payload and strips the BOM.

Other components are auto-discovered: `skills/exploring-codebase/` (protocol + `references/mcp-pruning.md`),
`commands/` (`/context-audit`, `/economy-stats`, `/economy-help`). `scripts/economy-stats.mjs` backs
`/economy-stats`. Options live in `userConfig` in `plugin.json`.

## Hook contract

Holds for all three, and it is what the tests check:

- **No effect** = exit 0 with empty stdout; **decision** = exit 0 with one JSON object on stdout. A non-zero
  exit code is not the deny channel.
- **Fail-open**: any internal error (malformed stdin, missing file, unwritable telemetry) ends in a silent
  exit 0. A guardrail that blocks work because of its own bug does more harm than the waste it prevents.
- Every read-guard deny appends `{ t, project, path, lines, bytes, saved }` to `denied.jsonl` in
  `CLAUDE_PLUGIN_DATA` (fallback `~/.claude/token-economy`), never in the user's repo. A logging failure
  must not change the decision.

## Gotchas

- Editing hooks, skills or commands has **no effect on the running session**: start a new one (or
  `/reload-plugins`). The installed cache only refreshes when `version` in `plugin.json` changes.
- Hermetic tests: every hook spawned in a test gets `CLAUDE_PLUGIN_DATA` and `cwd` in a temp dir and no
  `CLAUDE_PLUGIN_OPTION_*` inherited from the shell. Telemetry showing up in the repo or in `~/.claude`
  means a test is wrong.
- session-start tests run with an empty `PATH`, so no real grepai daemon ever starts; the start branch
  is covered only on POSIX, with a fake `grepai` script.
- Windows and POSIX are both CI targets: no hardcoded paths, no shell (`spawn` without `shell: true`),
  stdin stripped of the UTF-8 BOM PowerShell prepends.
- Another plugin with a PreToolUse on `Agent` returning `updatedInput` (e.g. context-mode) wins over the router.
- `benchmarks/results/<date>.md` is auto-generated and gitignored; curated reports with another name are tracked.

## Constraints

- No runtime dependencies. Node standard library only: the plugin must install without `npm install`.
- Never reach plugin files through absolute or cwd-relative paths: always `${CLAUDE_PLUGIN_ROOT}`.
- Never duplicate a threshold outside `limits.mjs`.
- Never make a hook blocking or slow: the watcher start is fire-and-forget (`--status` with a 3 s timeout),
  and `read-guard` never reads a file that stays under the budget.
- Every new hook behavior gets its test in `tests/`.
- Everything in English (code, docs, commits), except `README.it.md`, which is kept at content parity
  with `README.md`.
- Work plans and specs stay local: everything under `.claude/` except this file is gitignored.
  Never commit plans, specs or settings.
- This guide lives in `.claude/CLAUDE.md`, not at the root: the plugin directory validator flags a
  root `CLAUDE.md` (it is not loaded for plugin users).

## Environment variables

- `CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS` — read-guard token budget (default 10000).
- `CLAUDE_PLUGIN_OPTION_INJECT_POLICY` — `0`/`false` turns the policy off; legacy alias `TOKEN_ECONOMY_INJECT`.
- `CLAUDE_PLUGIN_OPTION_GREPAI_AUTOSTART` — `0`/`false` turns autostart off; legacy alias `GREPAI_WATCH_AUTOSTART`.
- `CLAUDE_PLUGIN_OPTION_EXPLORE_MODEL` — `haiku`/`sonnet`/`opus`/`fable`/`inherit` (default `haiku`).
- `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` — native Read cap, read by `limits.mjs` (default 25000).
- `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR` — provided by Claude Code to hooks.
