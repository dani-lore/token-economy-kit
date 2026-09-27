---
name: exploring-codebase
description: Token-efficient codebase exploration protocol. Use when exploring a codebase, understanding architecture, finding where something is defined or how a feature works, before any broad Read of source files. Triggers: "where is X defined", "how does X work", "find where", "explore the codebase", "understand the architecture", "dove si trova", "come funziona X nel codice", "esplora la codebase".
---

# Exploring a codebase

Every tool result stays in context for the rest of the session, so fetch the
smallest thing that answers the question.

## Question → tool

Pick by capability; the grepai names are examples of what a semantic index
offers, use them when its MCP server is connected.

| Question | Tool |
|---|---|
| Where is X defined / handled? (intent, not exact text) | Semantic search, e.g. `grepai_search` with `compact: true` to get locations only |
| Where does this exact string / identifier appear? | `Grep` (`output_mode: "files_with_matches"` or `head_limit` first) |
| Which files match a name pattern? | `Glob` |
| Who calls this function / what does it call? | Call graph, e.g. `grepai_trace_callers`, `grepai_trace_callees`, `grepai_trace_graph` (`depth` 2 by default) |
| Who reads / writes this property? | `Grep` on the name; the grepai CLI has `grepai refs readers` / `grepai refs writers` |
| What does this located section do? | `Read` with `offset`/`limit` around the hit |
| Wide question that needs many files read | Delegate to the Explore subagent (below) |
| Long command output (tests, builds, logs) | Filter at the source: `grep`, `head`, quiet/reporter flags; a sandboxing tool such as context-mode if installed |
| External library docs | A docs server such as context7 if installed, else the official docs page |

Never Read a file to find out whether it is the right one: search first.

## When a direct Read is right

- The file is already located and you are about to edit it (Read before Edit).
- The part you need fits a slice: `offset`/`limit` with `limit` up to 600 lines
  always passes the read-guard hook.
- Short files where the whole content is the point (configs, manifests, small
  modules). A whole-file Read estimated over the plugin's token budget (default
  10,000 tokens, option `read_max_tokens`) is denied, and the deny lists an
  outline with line numbers to aim the slice at.

## Delegating to Explore

A subagent has a fixed start-up cost (its own system prompt and tool
definitions) and its report still lands in this context. Delegate when the
volume to read is far larger than that: architecture questions, tracing a
feature across many files, surveys of a whole directory. Small lookups are
cheaper done directly with the table above.

The plugin routes an Explore call without a `model` to a cheaper model (option
`explore_model`, default `haiku`). Another plugin that rewrites Agent calls
(e.g. context-mode) can override that routing; passing `model: "haiku"`
explicitly always works.

Prompt template:

```
Find <specific thing> in this codebase.
Answer only that question, in at most 40 lines.
Report conclusions with path:line references.
Do not paste file contents or list every file you opened.
```

## Semantic queries

Describe the intent in plain words, not a keyword:

| Good | Weak |
|---|---|
| `where are user sessions invalidated after a password change` | `session` |
| `how are retries scheduled when an HTTP request times out` | `retry` |
| `where is the configuration file parsed at startup` | `config` |

If results look stale or miss code you know exists, check `grepai_index_status`
before trusting them.

For MCP hygiene (which servers load where), see `references/mcp-pruning.md`.
