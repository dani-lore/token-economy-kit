---
description: Quick reference for the token-economy plugin — policy, components, commands
---

Show the token-economy quick reference. One shot, change nothing: do not edit
files or persist state.

**Principle: locate, don't read.** Search finds the location; Read is surgical
(`offset`/`limit`) and only used to act. Reading blindly is the waste.

**Components**
- `read-guard` (PreToolUse hook) — denies blind Reads of text files over 600
  lines / 256 KB. The denial lists the alternatives. Fail-open on any hook error.
- `inject-policy` (SessionStart hook) — injects the 5-line policy each session.
- `exploring-codebase` (skill) — the full decision tree: which tool for which
  question, scout dispatch template, when a direct Read is actually right.
- `scout` (Haiku subagent) — broad reconnaissance (3+ files) in its own context,
  returns conclusions with `path:line`, never file dumps.

**Order of operations**
1. Locate code → semantic/pattern search (grepai / Grep / Glob), never exploratory Read.
2. Read only to act → `offset`/`limit`, the slice you need.
3. Broad exploration (3+ files, architecture) → dispatch `scout`.
4. Large command output → context-mode or filter at the source.

**Commands**
- `/context-audit` — measure the input-token bloat the guard removes on this repo.
- `/economy-help` — this card.

Tune the guard thresholds at the top of `hooks/read-guard.mjs` (`MAX_LINES`,
`MAX_BYTES`). Disable by removing the plugin or its hooks.
