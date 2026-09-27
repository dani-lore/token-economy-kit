# token-economy

[![test](https://github.com/dani-lore/token-economy-kit/actions/workflows/test.yml/badge.svg)](https://github.com/dani-lore/token-economy-kit/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Versione italiana: [README.it.md](README.it.md)

A Claude Code plugin that keeps input tokens down: it blocks whole-file Reads of
big files and points to the slice worth reading, sends the Explore subagent to a
cheaper model, and gives every session a short exploration policy.

## 1. Install in 30 seconds

Inside a Claude Code session:

```
/plugin marketplace add dani-lore/token-economy-kit
/plugin install token-economy@token-economy
```

Then start a new session (or run `/reload-plugins`).

**Check that it works:**

- `/economy-help` shows the plugin's reference card.
- `/hooks` lists `read-guard.mjs`, `explore-router.mjs` and `session-start.mjs`.
- Ask Claude to read a large file in full (a lockfile, a long changelog): the
  Read is blocked and the message carries an outline of the file.

## 2. What it does

| Component | Kind | What it does |
|---|---|---|
| `read-guard` | PreToolUse hook (`Read`) | Denies a whole-file Read when the file is estimated over the token budget (default 10,000). A Read with `limit` up to 600 lines always passes. The deny lists an outline of the file with line numbers. |
| `explore-router` | PreToolUse hook (`Agent`) | An Explore subagent launched without a model runs on a cheaper one (default `haiku`) and is asked for `path:line` conclusions instead of file dumps. |
| `session-start` | SessionStart hook | Injects a seven-line exploration policy, adapted to whether the project uses grepai, and starts `grepai watch` in grepai projects. |
| `exploring-codebase` | Skill | The detailed protocol, loaded on demand: which tool for which question, when a direct Read is right, when to delegate to Explore. |
| `/context-audit` | Command | How many input tokens the guard would remove in the current repo (a ceiling). |
| `/economy-stats` | Command | Savings the guard actually logged at deny time, for this project and all projects. |
| `/economy-help` | Command | Reference card: components, commands, options. |

A real deny, produced by `read-guard` on a file of
[microsoft/vscode-python](https://github.com/microsoft/vscode-python) (outline
shortened here, it had 14 entries):

```
Read blocked: "src/client/telemetry/index.ts" is ~31096 tokens (2582 lines); whole-file reads are capped at 10000 tokens. Read the part you need with offset/limit (limit ≤ 600), located via the outline below or Grep.
Outline:
L23 function isTelemetrySupported(): boolean {
L40 export function isTelemetryDisabled(): boolean {
L49 const sharedProperties: Record<string, unknown> = {};
L53 export function setSharedProperty<P extends ISharedPropertyMapping, E extends ke
L76 export function getTelemetryReporter(): TelemetryReporter {
```

The model can then Read, say, `offset: 40, limit: 60` instead of the whole file.

## 3. Configuration

Options are set in `/config`, under the plugin options:

| Option | Default | Effect | Legacy env alias |
|---|---|---|---|
| `read_max_tokens` | `10000` (min `2000`) | Whole-file Reads estimated above this many tokens are blocked. | — |
| `inject_policy` | `true` | Inject the exploration policy at session start. | `TOKEN_ECONOMY_INJECT=0` |
| `grepai_autostart` | `true` | Start `grepai watch` in the background in projects with `.grepai/config.yaml`. | `GREPAI_WATCH_AUTOSTART=0` |
| `explore_model` | `haiku` | Model for Explore subagents launched without one: `haiku`, `sonnet`, `opus`, `fable`, or `inherit` to keep the main model. | — |

A toggle is off when either the option or its legacy variable is `0` or `false`.

With `inject_policy` off you can put the policy in your `CLAUDE.md` instead.
This is the text the hook injects in a grepai project:

```
Every tool result stays in context for the rest of the session, so fetch less.
Locate with grepai_search first (compact: true for locations only), then Grep/Glob for exact strings.
Read to act, in slices: offset/limit (limit ≤ 600); whole-file reads over ~10k tokens are blocked by a hook.
Wide questions that need many files read: delegate to the Explore subagent and ask for path:line conclusions; small lookups are cheaper done directly.
Long command output: filter at the source (grep, head, quiet flags).
Full protocol: skill exploring-codebase.
```

Without grepai, the second line becomes "Locate with Grep/Glob instead of exploratory Reads."

## 4. How it works

- **Enforcement, not advice.** A rule in `CLAUDE.md` is followed most of the
  time and forgotten under pressure; no prompt line can stop a Read. A PreToolUse
  hook runs in the harness before every tool call and denies it deterministically.
  The policy text is the advice; `read-guard` is the enforcement.
- **Fail-open.** Any internal error (malformed input, missing file, unwritable
  log) lets the call through. A guardrail that blocks work because of its own bug
  does more damage than the waste it prevents.
- **A token budget, not a line count.** Lines are a poor proxy: 900 short lines
  cost about 2,000 tokens, 50 minified lines can cost 25,000. The guard estimates
  tokens from the file size (`bytes / 4`) without reading the file, and only reads
  a prefix to build the line count and the outline once it has decided to deny.
- **Native Read caps.** Claude Code's Read already returns at most 2,000 lines
  and truncates output over a token cap (25,000 by default,
  `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`). A blind Read of a big file still
  lands up to that much mostly irrelevant text in context; the deny costs a few
  hundred tokens and names the slice to read.
- **Explore routing.** The built-in Explore subagent is read-only and skips
  `CLAUDE.md`, but inherits the main session's model. `explore-router` adds a
  `model` (default `haiku`) to Explore calls that have none, plus a one-line
  report contract. A call with an explicit `model` is left alone.
- **grepai autostart.** On session startup or resume, in a project with
  `.grepai/config.yaml` (searched upward from the cwd), the hook checks
  `grepai watch --status` and, if no watcher runs, starts `grepai watch --background`
  and tells you so. The daemon keeps running after the session ends; stop it with
  `grepai watch --stop`.

## 5. Numbers

The saving is input-side (tokens spent reading) and scales with how much
oversized material a repo carries. Measured by
[`benchmarks/score.mjs`](benchmarks/score.mjs), deterministic, no API calls,
with both arms capped the way the native Read is:

| corpus | files over budget | input-token cut (ceiling) |
|---|--:|--:|
| clean app template ([fastapi](https://github.com/fastapi/full-stack-fastapi-template)) | 3 / 238 | **4.1%** |
| mid-size codebase ([vscode-python](https://github.com/microsoft/vscode-python)) | 20 / 1,464 | **9.5%** |

This is the removable ceiling (every file read blindly once), not the saving
realized in an average session, and ~0% on repos where every file is small.
Details and per-file figures:
[benchmarks/results/2026-09-27-input-bloat.md](benchmarks/results/2026-09-27-input-bloat.md);
method and limits: [benchmarks/README.md](benchmarks/README.md).
`/context-audit` runs the same measurement on your repo, `/economy-stats` shows
what the guard actually logged.

## 6. Privacy

Everything stays on your machine; nothing is sent anywhere. Each deny appends one
line to `denied.jsonl` in the plugin data directory
(`~/.claude/plugins/data/token-economy-token-economy/`) with: timestamp, project
directory, file path as passed to Read, line count, size in bytes, estimated tokens
saved. No file contents. The directory is deleted when you uninstall the plugin,
and you can delete the file at any time.

## 7. Compatibility

- Developed on Claude Code 2.1 (update with `claude update`). Older versions that
  don't know plugin options ignore them and use the defaults.
- Needs Node.js (current LTS) on the PATH to run the hooks, also when Claude Code
  was installed with the native installer, which doesn't bring Node.
- Windows, macOS and Linux; CI runs on Ubuntu and Windows.

## 8. Troubleshooting

- **Nothing happens, or hooks report `node` not found.** Install Node.js LTS and
  make sure `node --version` works in the shell Claude Code starts from.
- **The guard is too strict.** Raise `read_max_tokens` in `/config`. Reads with
  `limit` up to 600 lines always pass.
- **Everything happens twice** (two policies, two denies). You have both a manual
  setup (§11) and the plugin: remove the manual hooks from `settings.json`.
- **Changes from a new release don't show up.** Run
  `/plugin marketplace update token-economy`, then
  `/plugin update token-economy@token-economy`, then start a new session.
- **Explore still runs on the main model.** Another plugin that rewrites Agent
  calls (for example context-mode) wins over the router. Pass `model: "haiku"`
  explicitly in the Agent call, or set `explore_model` to `inherit` and accept the
  main model.

## 9. Companion tools

Optional. Without them the plugin falls back to `Grep`/`Glob` and filtering at
the source; with them, each removes a different kind of waste.

| Tool | Waste it removes | Source |
|---|---|---|
| **grepai** | Exploratory search in your code: local semantic index, search by intent, get `path:line` | [yoanbernabeu/grepai](https://github.com/yoanbernabeu/grepai) |
| **context-mode** | Raw command output (tests, builds, logs): runs it in a sandbox and lets you query it | [mksglu/context-mode](https://github.com/mksglu/context-mode) |
| **context7** | Stale library docs: current documentation on demand | [upstash/context7](https://github.com/upstash/context7) |

**grepai.** Needs [Ollama](https://ollama.com) with `nomic-embed-text` (local) or
an OpenAI key for embeddings.

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

Per project:

```bash
grepai init                                   # creates .grepai/
claude mcp add grepai -s local -- grepai mcp-serve
```

The plugin then starts `grepai watch` for you. To share the server with a team,
commit a `.mcp.json` with `{ "mcpServers": { "grepai": { "command": "grepai", "args": ["mcp-serve"] } } }`.

**context-mode.** In a session: `/plugin marketplace add mksglu/context-mode`,
`/plugin install context-mode@context-mode`, then check `/context-mode:ctx-doctor`.
Its own PreToolUse hook rewrites Agent calls: see §8 for the Explore routing.

**context7.** `/plugin install context7@claude-plugins-official`, or as an MCP
server: `claude mcp add context7 -- npx -y @upstash/context7-mcp`.

**Also evaluated, briefly:**

- [ccusage](https://github.com/ryoppippi/ccusage): recommended, a local CLI that
  reports token usage from Claude Code's logs; use it to measure before and after.
- [Serena](https://github.com/oraios/serena): symbol-level code intelligence,
  worth it per repo for heavy cross-file refactoring, too many tools as a default.
- Exa / Tavily MCP: only for research-heavy sessions.
- Memory MCPs: excluded, they add per-session injections; state in files does the job.
- Repomix: excluded, it packs the whole repo into context, the opposite approach.

## 10. Beyond the plugin

- **MCP hygiene.** Every connected MCP server adds its tool definitions to every
  session in its scope. Keep the `user` scope for what you use everywhere, `local`
  or a committed `.mcp.json` for the rest, and turn off unused claude.ai connectors.
  Procedure: [`mcp-pruning.md`](skills/exploring-codebase/references/mcp-pruning.md).
- **Session practices.** One session per task, `/clear` between unrelated tasks,
  state in files (a short `STATUS.md`, plans on disk) rather than in the
  conversation. Decide with a capable model, delegate mechanical work and wide
  exploration to cheaper subagents. Process skills such as
  [superpowers](https://github.com/obra/superpowers) fit well but are not required.

## 11. Manual setup (without the plugin system)

The hooks and the skill also work as plain files; the commands and the
`/config` options are available only through the plugin.

Copy `hooks/*.mjs` (all five: the three hooks plus `limits.mjs` and `stdin.mjs`)
to `~/.claude/hooks/token-economy/`, and `skills/exploring-codebase/` to
`~/.claude/skills/exploring-codebase/`. Then register the hooks in
`~/.claude/settings.json`.

macOS / Linux:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Read", "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/token-economy/read-guard.mjs\"" }] },
      { "matcher": "Agent|Task", "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/token-economy/explore-router.mjs\"" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/token-economy/session-start.mjs\"" }] }
    ]
  }
}
```

Windows: the same, with paths like
`"node \"C:\\Users\\<user>\\.claude\\hooks\\token-economy\\read-guard.mjs\""`.

Options become environment variables in the `env` block of `settings.json`:
`CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS`, `CLAUDE_PLUGIN_OPTION_INJECT_POLICY`,
`CLAUDE_PLUGIN_OPTION_GREPAI_AUTOSTART`, `CLAUDE_PLUGIN_OPTION_EXPLORE_MODEL`.
Without the plugin, deny telemetry goes to `~/.claude/token-economy/denied.jsonl`.

## 12. Uninstall

```
/plugin uninstall token-economy@token-economy
```

The plugin data directory, telemetry included, is deleted with it. A `grepai watch`
daemon started by the plugin keeps running: stop it with `grepai watch --stop` in
the project. Manual setup: remove the hook entries from `settings.json` and the
copied files.

## 13. Development

Node ESM, no dependencies, no build step.

```
npm test                                # all tests (Node 21+ for the test glob)
npm run bench                           # benchmark this repo, writes benchmarks/results/<date>.md
node benchmarks/score.mjs --dir <path>  # benchmark any directory, print only
```

To try local changes: `/plugin marketplace add <path-to-clone>`,
`/plugin install token-economy@token-economy`, then a new session; changes to
hooks, skills or commands never affect a session already running. Contributor
notes: [AGENTS.md](AGENTS.md). Changes: [CHANGELOG.md](CHANGELOG.md).
License: [MIT](LICENSE).
