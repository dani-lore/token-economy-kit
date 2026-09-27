# Changelog

## 2.0.1 — 2026-09-27

- `/context-audit` and `/economy-stats` pre-approve only their own plugin script, not `Bash(node *)`.
- Plugin icon added (`.claude-plugin/icon.svg`).
- READMEs link to the grepai install instructions instead of piping a remote script into a shell.
- Contributor guide moved to `.claude/CLAUDE.md`.

## 2.0.0 — 2026-09-27

### Breaking

- **Token budget instead of line/byte limits.** read-guard denies a whole-file Read
  when the file is estimated over `read_max_tokens` (default 10,000 tokens), not
  over 600 lines or 256 KB. A Read with `limit` up to 600 lines always passes;
  `offset` without `limit` no longer does. `.lock` files are judged like any text file.
- **Shell guard removed.** `cat`, `type`, `Get-Content` and `gc` dumps are no longer
  intercepted; the hook only matches `Read`.
- **scout agent removed.** Broad exploration goes to the built-in Explore subagent,
  which the plugin now routes to a cheaper model.
- **Options via `userConfig`.** Settings live in `/config`: `read_max_tokens`,
  `inject_policy`, `grepai_autostart`, `explore_model`. The old env toggles
  `TOKEN_ECONOMY_INJECT` and `GREPAI_WATCH_AUTOSTART` still work as aliases.
- **Telemetry moved.** Denies are logged to `denied.jsonl` in the plugin data
  directory (`CLAUDE_PLUGIN_DATA`, removed on uninstall) with a `project` field,
  instead of `.claude/token-economy/` inside each project.

### Added

- Outline in the deny message: markdown headings or column-0 declarations with
  line numbers, to aim an `offset`/`limit` slice.
- `explore-router` hook: an Explore subagent launched without a model runs on
  `explore_model` (default `haiku`) and is asked for `path:line` conclusions.
- Single SessionStart hook: the injected policy adapts to whether the project
  uses grepai, and reports when it starts `grepai watch`.
- `/economy-stats` backed by a script, per project and across projects; commands
  declare `allowed-tools` so they run outside auto mode.
- `LICENSE` (MIT), this changelog.

### Changed

- Thresholds live in one module, `hooks/limits.mjs`, shared by the hook and the
  benchmark.
- The benchmark caps both arms at the native Read limits (2,000 lines, 25,000
  tokens), scores the current directory by default, uses `git ls-files` in a repo
  and writes a report only with `--out`.
- The exploring-codebase skill is rewritten in English around capabilities
  (question → tool), and delegates wide exploration to Explore.
- The injected policy is in English and goes to `additionalContext`.
- Commands are user-only (`disable-model-invocation`): the model no longer sees
  or invokes them.
- READMEs rewritten; contributor notes in `CLAUDE.md`.

## 1.0.0 — 2026-06-11

First release. Later additions up to 2026-07 shipped without a version bump.

- read-guard PreToolUse hook: denies blind Reads of text files over 600 lines or
  256 KB, plus a dense/generated-file heuristic and shell dump interception.
- SessionStart policy injection and `grepai watch` autostart.
- scout agent (low-cost reconnaissance) and the exploring-codebase skill.
- `/context-audit`, `/economy-stats`, `/economy-help` commands; deny telemetry.
- Deterministic input-bloat benchmark and hook test suite.
