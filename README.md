# token-economy

> 🇮🇹 Versione italiana: [README.it.md](README.it.md)

Claude Code plugin for token-efficient sessions. Self-contained package: this README has everything you need to understand, install, and adopt the system — including the policies to add to your global `CLAUDE.md` and instructions for the recommended companion tools.

---

## 1. The problem

In Claude Code sessions, a significant portion of input tokens is spent on **exploratory reads**: the model opens entire files (sometimes very long ones) to "figure out where the thing is," when a targeted search would have returned the exact location in a few lines. The consequences are cost — but more importantly, degradation: a bloated context worsens the model's attention and brings forward compaction (lossy summarization).

Two facts drive the design of this kit:

1. **Textual instructions are advisory.** A rule in `CLAUDE.md` ("don't read entire files") is respected most of the time at the start of a session and forgotten under pressure or in long sessions. No prompt line can *prevent* a Read.
2. **Only hooks are enforcement.** A `PreToolUse` hook is executed by the harness (not the model) before every tool call, and can deny it deterministically.

The operating principle is: **locate, don't read**. Search (semantic or pattern-based) finds the location; Read is surgical (`offset`/`limit`) and only used to act (Edit, targeted verification). Reading is not forbidden — reading *blindly* is.

### Numbers

The saving is input-side (tokens spent *reading*) and scales with how much
oversized material a repo carries. Measured deterministically by
[`benchmarks/score.mjs`](benchmarks/score.mjs) — no API calls, runs in CI:

| corpus | files over limit | input-token cut |
|---|--:|--:|
| clean app template (fastapi) | 2 / 213 | **6.1%** |
| mid-size codebase (vscode-python) | 42 / 1,415 | **27.3%** |

The cut is biggest where an agent would otherwise read generated/aggregate files
in full (`package-lock.json`: 303k → 7k tokens) and ~0% on already-lean repos —
the harness reports that honestly rather than a single flattering figure. Method,
limits, and reproduction: [benchmarks/README.md](benchmarks/README.md).
Run the hook test suite with `npm test`.

## 2. The 4 plugin components

| Component | File | Level | What it does |
|---|---|---|---|
| **read-guard** | `hooks/read-guard.mjs` | Enforcement | PreToolUse hook: denies Reads without `offset`/`limit` on text files > 600 lines or > 256 KB. The rejection message lists the 3 alternatives (search → targeted Read → scout subagent). Fail-open: any internal hook error lets the Read through — it never blocks work due to its own bug. |
| **inject-policy** | `hooks/inject-policy.mjs` | Policy | SessionStart hook: injects 5 policy lines into every session's context. Users who install the plugin don't need to touch their `CLAUDE.md` (but can, see §5). |
| **exploring-codebase** | `skills/exploring-codebase/SKILL.md` | Protocol | On-demand skill: full decision tree (which tool for which question), scout dispatch template, examples of effective semantic queries, cases where direct Read IS the right choice. The detail lives in the skill precisely to avoid bloating the fixed context. |
| **scout** | `agents/scout.md` | Delegation | Subagent on the **Haiku** model (~20-30× cheaper than top models): performs broad reconnaissance (3+ files, architectural overviews) in its *own* context and reports only conclusions with `path:line` references, max ~40 lines, never file dumps. Everything it reads dies with it. |

### Why this architecture (design rationale)

- **Short policy + detail skill**: a long policy in the fixed context gets respected less and is itself waste. The 5 injected lines point to the skill, which only loads when exploration is needed.
- **Subagent for exploration**: when a subagent explores, the files read and raw outputs stay in its isolated context; only the summary returns to the main session. It's the most robust way to keep context clean, and it's native (no external dependencies).
- **600-line / 256 KB thresholds**: high enough not to interfere with normal work (configs, mid-size components pass through), low enough to catch the files that hurt context. Adjustable at the top of `read-guard.mjs` (`MAX_LINES`, `MAX_BYTES`).
- **Fail-open**: a guardrail that blocks work due to a bug causes more damage than the waste it prevents.

## 3. Prerequisites

- **Claude Code** v1.0.33+ (`claude --version`; update with `npm update -g @anthropic-ai/claude-code`)
- **Node.js** 18+ on PATH (runs the `.mjs` hooks)
- **Recommended, not included**: grepai, context-mode, context7 — see §6. The kit works without them (the guardrail and scout fall back to `Grep`/`Glob`), but the bulk of *location* savings comes from semantic search.

**Starting from zero is supported.** Everything not included in the kit is optional and the system degrades explicitly: without grepai, scout and the skill fall back to `Grep`/`Glob`; without context-mode, the policy asks to filter output at the source (`head`, `grep`, `--quiet` flags); without context7, docs via WebFetch on the official page. No component fails due to a missing tool (absent MCP tools simply don't appear). Incremental adoption recommended: plugin first, then grepai (the single most profitable upgrade), then the rest.

## 4. Plugin installation

`/plugin` commands run **inside a Claude Code session** (slash commands), not from the terminal.

From a GitHub repo:

```
/plugin marketplace add dani-lore/token-economy-kit
/plugin install token-economy@token-economy
/reload-plugins
```

From a local path (testing or private use):

```
/plugin marketplace add C:\path\to\token-economy-kit
/plugin install token-economy@token-economy
```

**Visible effects after installation** (new session):

- at session start, the "Token Economy policy (plugin)" block appears;
- a full Read of a long file is rejected with a message proposing alternatives; a Read with `offset`/`limit` passes normally;
- the `scout` agent is available in the Agent tool and the `exploring-codebase` skill appears in the skill list.

### Manual setup (without plugin system)

Copy the files to `~/.claude/`:

```
~/.claude/hooks/read-guard.mjs
~/.claude/hooks/inject-policy.mjs        (optional if you put the policy in CLAUDE.md, §5)
~/.claude/skills/exploring-codebase/SKILL.md
~/.claude/skills/exploring-codebase/references/mcp-pruning.md
~/.claude/agents/scout.md
```

Then register the hooks in `~/.claude/settings.json` (adjust paths; on macOS/Linux `~/.claude/...`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\<user>\\.claude\\hooks\\read-guard.mjs\"" }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\<user>\\.claude\\hooks\\inject-policy.mjs\"" }
        ]
      }
    ]
  }
}
```

## 5. Policy for the global CLAUDE.md (recommended)

The plugin already injects the policy on every SessionStart. If you prefer to have it permanently in your `~/.claude/CLAUDE.md` (works without the plugin too, and is more visible/customizable), add this section — this is the reference version:

```markdown
## Token Economy (MANDATORY)

**Locate, don't read.** Mandatory order:
1. **Locating code** → `grepai_search` / `grepai_trace_*` (if indexed), else `Grep`/`Glob`. Never exploratory Read.
2. **Read** only to act (Edit / targeted verification) and only narrow: `offset`/`limit` on the section you need. Full Read of files >600 lines: forbidden (hook blocks it).
3. **Broad exploration** (architecture, "where is X", 3+ files) → `scout` subagent (Haiku): returns conclusions, not dumps.
4. **Command output >20 lines** → context-mode (`ctx_batch_execute`) if installed, else filter at the source (head, grep, targeted flags); **library docs** → context7 if installed, else WebFetch the official docs page.
5. Detailed protocol: skill `exploring-codebase`.
```

Optional but consistent with the system, also in the global CLAUDE.md:

```markdown
### Subagent strategy
- Offload research, exploration, and parallel analysis to subagents (one task per subagent).
- Use the cheapest model that can do the job: Haiku for search/recon, Sonnet for mechanical plan execution, top model for decisions and non-trivial code.
```

> If you use the [superpowers](https://github.com/anthropics/claude-plugins) plugin (or equivalent process skills like `brainstorming` / `writing-plans`), you can also add a line that invokes them explicitly for non-trivial tasks. **This is not a prerequisite**: this kit does not depend on superpowers or any other process skill.

If you use both the plugin and the CLAUDE.md, the policy appears twice (harmless, ~80 tokens). To avoid it: remove the SessionStart hook from your `settings.json` or don't add the section to CLAUDE.md.

## 6. Recommended tools: what they do and how to install them

Three complementary tools, each eliminating a different category of waste. Commands verified against official sources (June 2026).

| Tool | Category of waste eliminated | Source |
|---|---|---|
| **grepai** | Exploratory Read/Grep on *your code*: local semantic index, search by intent ("where is toggle state persisted"), get `path:line` | github.com/yoanbernabeu/grepai |
| **context-mode** | Raw *command* output (tests, builds, logs, JSON): runs in sandbox, indexes it, you query the index instead of receiving 500 lines in context | github.com/mksglu/context-mode |
| **context7** | Stale *external library* documentation: up-to-date docs on demand, avoids trial-and-error cycles on changed APIs and WebSearch | github.com/upstash/context7 |

### grepai (semantic codebase search)

Prerequisite: [Ollama](https://ollama.com) with the `nomic-embed-text` model (default, fully local), or an OpenAI API key for embeddings.

```powershell
# Windows
irm https://raw.githubusercontent.com/yoanbernabeu/grepai/main/install.ps1 | iex
```

```bash
# macOS
brew install yoanbernabeu/tap/grepai
# Linux/macOS
curl -sSL https://raw.githubusercontent.com/yoanbernabeu/grepai/main/install.sh | sh
```

For each project, first-time indexing and MCP registration:

```bash
cd <project>
grepai init          # creates .grepai/ and configures
grepai watch         # indexes and keeps the index up to date
claude mcp add grepai -s local -- grepai mcp-serve
```

Alternatively, to share it with the team, commit a `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "grepai": { "command": "grepai", "args": ["mcp-serve"] }
  }
}
```

Note: the index goes stale — after large refactors, check with `grepai_index_status` and re-index before trusting results.

### context-mode (command output out of context)

Inside a Claude Code session:

```
/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
/reload-plugins
```

Verify with `/context-mode:ctx-doctor` (all checks `[x]`). Hooks and MCP tools (`ctx_batch_execute`, `ctx_search`, `ctx_execute`...) register themselves automatically.

### context7 (up-to-date library docs)

The official marketplace is already registered in Claude Code:

```
/plugin install context7@claude-plugins-official
```

Alternatively as a direct MCP server: `claude mcp add context7 -- npx -y @upstash/context7-mcp`. Free API key (higher rate limits) at context7.com/dashboard.

### Evaluated complements (June 2026) — and what we deliberately excluded

The landscape was surveyed before settling on the triad. Verdicts, so you don't have to repeat the evaluation:

- **[ccusage](https://github.com/ryoppippi/ccusage)** — *recommended, zero cost.* A local CLI (not an MCP: adds nothing to context) that reads Claude Code's JSONL logs and reports token usage per day/session/project. Use it to measure your baseline before and after adopting the kit: `npx ccusage`.
- **[Serena](https://github.com/oraios/serena)** — *optional, per-repo.* LSP-based code intelligence (symbol-level find-references, cross-file renames). Genuinely complementary to grepai (semantic search by intent vs. exact symbol graph), but injects ~15 tool definitions per session. Worth it in repos with heavy cross-file refactoring; overkill as a default.
- **Exa / Tavily MCP** — *optional, research-heavy users only.* Condensed web search results instead of full-page fetches. Adds an MCP + API key; for coding work, web research is a minor waste category. Skip unless your sessions are research-dominated.
- **Memory MCPs (claude-mem, mem0, basic-memory)** — *excluded.* They reduce context re-derivation but add per-session injections and retrieval latency — exactly the fixed-context cost this kit fights. State-in-files (§8) covers the same need for free.
- **Repomix** — *excluded.* Packs the whole repo into context for one-shot analysis: the opposite philosophy of retrieve-on-demand. Useful for one-off external audits, a net regression as a session workflow.

Native Claude Code features (deferred tool schemas, auto-compaction) keep improving and reduce the fixed cost of installed MCPs — but they don't replace any element of the triad.

## 7. MCP hygiene and fixed context (the savings you don't see)

Often the biggest waste isn't Reads: it's the **fixed context** loaded at every session.

- **MCP servers with `user` scope** load their tools into *every* repo. Rule: `user` scope only for what you use everywhere; `local` scope (per-project, private) for the rest; committed `.mcp.json` for what the whole team needs. Full procedure, with `claude mcp add/remove/list` commands, in [`skills/exploring-codebase/references/mcp-pruning.md`](skills/exploring-codebase/references/mcp-pruning.md).
- **Plugins with many skills** (e.g. example collections): each skill adds its description to every session's context. Disable non-daily ones globally (`/plugin`), re-enable them per-repo where needed (`.claude/settings.local.json` → `enabledPlugins`).
- **claude.ai connectors** (Gmail, Drive, travel, etc.): managed from claude.ai → Settings → Connectors, not from the CLI. Disable those you don't use for work.
- **SessionStart hooks**: every automatic injection has a per-session cost. Keep high-value ones (e.g. a ~10-line project STATUS.md), remove the rest.

A short context isn't just cheaper: it degrades the model's attention less and delays compaction. It's a *quality* benefit, before being a cost one.

## 8. Beyond the plugin: session practices

The plugin covers *instrumental* waste (reads, output, docs, fixed context). The two remaining levers are behavioral — no hook can do them for you, and together they're worth as much as everything else:

**Session hygiene.** A session's cost grows super-linearly with its length: every exchange re-transmits the entire prior history. So: one session = one task; `/clear` between unrelated tasks; persistent state in *files*, not in the conversation (a ~10-line `STATUS.md` with current phase and active plan, checkbox plans in `plans/*.md`, decisions in ADRs). If state lives in files, every session can start short and cold without losing anything — and it's also the prerequisite for delegating to subagents.

**Model orchestration.** Not every step deserves the same model: plan and decide with the capable model, execute mechanical work with a cheaper one. In practice: Haiku subagent for search/reconnaissance (scout), Sonnet subagent for well-specified plan tasks, top model in the main session for architecture, review, and non-trivial code. The reverse also works: daily session on Sonnet, `/model` to switch up only when needed.

**When to stop.** This kit + the two practices above are the high-yield baseline. Beyond that (manual cache tuning, aggressive output compression, micro-managing every tool call) returns collapse: hours of configuration for percentage points, and overly rigid rules start to cost in *response quality*. If the guardrail blocks you more than once a day, raise the thresholds instead of adding exceptions.

## 9. Deactivation / rollback

```
/plugin uninstall token-economy
```

Manual setup: remove the `hooks` entries from `settings.json` and delete the copied files. The entire kit is additive: no destructive changes to undo.

To retune the guardrail thresholds without uninstalling: edit `MAX_LINES` / `MAX_BYTES` in `hooks/read-guard.mjs`.
