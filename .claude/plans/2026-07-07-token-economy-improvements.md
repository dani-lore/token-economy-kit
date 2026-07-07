# Token-Economy Kit — Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `subagent-driven-development` or `executing-plans` to implement task-by-task. Steps use `- [ ]` for tracking.
> **Note:** kept lean per Dani's global plan-file rules (no full code/test bodies; files + scope + acceptance per task). Code shown only where it pins an interface.

**Goal:** Close the four remaining gaps from the kit review (points 2–5): realized-savings telemetry, redundant policy injection, type-aware thresholds, honest benchmark framing.

**Architecture:** All enforcement stays in the single `hooks/read-guard.mjs` (already extended to Read + shell dumps in point 1). Telemetry is a best-effort append at deny time, surfaced by a new slash command. No proxy, no new runtime dependency — Node stdlib only.

**Tech Stack:** Node 18+ ESM `.mjs` hooks, `node:test`, Claude Code plugin hooks/commands.

---

## Global constraints (apply to every task)

- **Fail-open is sacred:** every new code path wrapped so any error → allow / no-op. A telemetry or heuristic bug must never block a tool call.
- **No new deps:** `node:fs`/`node:path` only.
- Keep `MAX_LINES` / `MAX_BYTES` in sync between `hooks/read-guard.mjs` and `benchmarks/score.mjs`.
- Verify with `npm test` after each task; conventional commit + `Co-Authored-By: Claude Fable 5`.
- Tasks 1 and 4 are independent `[PARALLEL]`. Tasks 2 and 3 both edit `read-guard.mjs`: run **2 before 3**, not in parallel.

---

## Task 1 — Opt-out for the SessionStart policy injection `[PARALLEL]`

Removes the ~80–100 token/session duplication when the policy already lives in the user's `CLAUDE.md` (Dani's case).

**Files:**
- Modify: `hooks/inject-policy.mjs`
- Test: `tests/inject-policy.test.mjs`
- Doc: `README.md` §5, `README.it.md` §5

- [ ] **Step 1 — Test (write first, expect fail):** with env `TOKEN_ECONOMY_INJECT=0`, hook exits 0 with **empty stdout**; unset/any other value → stdout contains the policy header. Add two cases to `tests/inject-policy.test.mjs` (pass `env` through `spawnSync`).
- [ ] **Step 2 — Implement:** at the top of `inject-policy.mjs`, `if (process.env.TOKEN_ECONOMY_INJECT === '0') process.exit(0);` before the `process.stdout.write(...)`.
- [ ] **Step 3 — Verify:** `npm test` green.
- [ ] **Step 4 — Doc:** in §5 note the double-injection escape hatch: set `TOKEN_ECONOMY_INJECT=0` (or drop the SessionStart hook) when the policy is in `CLAUDE.md`.
- [ ] **Step 5 — Commit** (`feat: allow disabling policy injection via env`).

**Acceptance:** injection is suppressible without uninstalling; default behavior unchanged.

---

## Task 2 — Realized-savings telemetry at deny time

Turns the static benchmark ceiling into an observed per-repo number. Logging happens **inside `read-guard.mjs` at the deny moment** (a denied Read never reaches PostToolUse), best-effort.

**Files:**
- Modify: `hooks/read-guard.mjs` (add `logDeny`, call it in both deny branches)
- Create: `commands/economy-stats.md`
- Modify: `.gitignore`
- Test: `tests/read-guard.test.mjs`

- [ ] **Step 1 — Test (expect fail):** after a denied Read of a 601-line file, a JSONL record exists at `<cwd>/.claude/token-economy/denied.jsonl` with fields `t, tool, path, lines, bytes, saved` and `saved > 0`. Run the hook with `cwd` set to a temp dir; assert the file's last line parses and `saved > 0`. Add one case; use a temp `cwd` so it never writes into the repo.
- [ ] **Step 2 — Implement `logDeny(record)`:** append one line via `appendFileSync` (with `mkdirSync(dir,{recursive:true})`), **entirely wrapped in try/catch → no-op on error**. Record shape:

  ```
  { t: Date.now(), tool, path, lines, bytes, saved }
  ```
  `saved` = `ceil(bytes/4)` minus the guarded-slice estimate (first `MAX_LINES` lines for line-over; `MAX_BYTES` for byte-over) — the same ceiling `benchmarks/score.mjs` reports, labeled as an estimate. Call `logDeny` from `oversizeReason`'s caller in both the Read and shell-dump deny paths (pass the tool name).
- [ ] **Step 3 — Verify fail-open:** add a case pointing the log dir at an unwritable path (or simulate) → deny still returns normally, no throw. `npm test` green.
- [ ] **Step 4 — `/economy-stats` command:** reads `denied.jsonl`, reports in ≤6 lines: total tokens avoided (est.), event count, top 3 offenders (path, lines, saved). One judgement line. Read-only, changes nothing. Mirror the frontmatter/tone of `commands/context-audit.md`.
- [ ] **Step 5 — .gitignore:** add `.claude/token-economy/`.
- [ ] **Step 6 — Doc + Commit:** note the command in `README.md`/`README.it.md` §2 command list and `commands/economy-help.md`. Commit (`feat: log realized read-guard savings + /economy-stats`).

**Acceptance:** denies accumulate a gitignored JSONL; `/economy-stats` sums it; a broken log path never breaks a deny. State clearly in the command output that `saved` is a ceiling (assumes the agent would otherwise have read the whole file).

---

## Task 3 — Type-aware threshold for generated/minified files

Lower priority (YAGNI-check: the 256 KB byte guard already catches most lock/minified files). Adds a stricter rule for dense files that slip under both limits.

**Files:**
- Modify: `hooks/read-guard.mjs` (extend `oversizeReason`)
- Test: `tests/read-guard.test.mjs`
- Doc: `README.md`/`README.it.md` design-rationale bullet

- [ ] **Step 1 — Test (expect fail):** a ~200-line file whose average line length is very high (e.g. one 300 KB… no: keep under 256 KB, ~150 KB across 200 lines) is **denied**; a normal 550-line source (short lines) still **passes**. Add both cases.
- [ ] **Step 2 — Implement heuristic:** in `oversizeReason`, after the existing checks, compute `avgLineLen = size / lines`; if `avgLineLen > DENSE_AVG` (start at `400`) **and** `size > DENSE_BYTES` (start at `50*1024`) → deny with a "dense/generated file" reason reusing `ALTERNATIVES`. Add `DENSE_AVG`/`DENSE_BYTES` as named constants next to `MAX_LINES`. Keep it a pure size/shape function (no filename allowlist — YAGNI).
- [ ] **Step 3 — Verify:** `npm test` green; confirm no regression on the existing 550-line and edge-600 cases.
- [ ] **Step 4 — Doc + Commit:** one bullet in the design rationale explaining the dense-file rule and its tunable constants. Commit (`feat: deny dense/generated files under the line limit`).

**Acceptance:** dense files under 600 lines/256 KB are caught; ordinary source near the limit is untouched; constants documented and tunable.

---

## Task 4 — Honest benchmark framing `[PARALLEL]`

Docs only. The §1 table reads like realized savings; align it with `benchmarks/README.md` "Honesty notes".

**Files:**
- Modify: `README.md` §1 (table header + one clause), `README.it.md` §1

- [x] **Step 1 — Reword:** rename the column `input-token cut` → `input-token cut (ceiling)` and add one clause near the table: this is the removable ceiling (blind full Reads), not average realized savings — see `benchmarks/README.md`.
- [x] **Step 2 — Mirror in `README.it.md`** with the same wording (Italian). N/A as scoped: `README.it.md` §1 has no "### Numbers" subsection/table at all (pre-existing translation gap, unrelated to this task) — nothing to relabel there. Flagged for follow-up, not fixed here to keep the diff minimal.
- [x] **Step 3 — Commit** (`docs: label benchmark figure as a ceiling, not realized savings`).

**Acceptance:** headline table and Honesty notes agree; no numbers changed, only their framing.

---

## Self-review notes

- Coverage: points 2 (Task 2), 3 (Task 1), 4 (Task 3), 5 (Task 4) — all four mapped. Point 1 already shipped.
- Naming consistency: `logDeny`, `denied.jsonl`, `.claude/token-economy/`, `TOKEN_ECONOMY_INJECT`, `DENSE_AVG`/`DENSE_BYTES` used identically across tasks.
- Ordering: 1 & 4 anytime; 2 before 3 (shared file). Every task ends green + committed.
