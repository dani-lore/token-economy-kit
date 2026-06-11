---
name: exploring-codebase
description: Token-efficient codebase exploration protocol. Use when exploring a codebase, understanding architecture, finding where something is defined or how a feature works, before any broad Read of source files. Triggers: "dove si trova", "come funziona X nel codice", "esplora la codebase", "capire l'architettura", "find where", "how does X work".
---

# Exploring Codebase — Operational Protocol

## Decision Tree

**Pointed question ("where is X defined?")**
→ 1 `grepai_search` query (MCP grepai, if available), fallback `Grep` with exact pattern.
→ NEVER exploratory Read before you know the file.

**Function relationships (who calls / what does it call)**
→ `grepai_trace_callers` / `grepai_trace_callees`

**Property access patterns (who reads / writes a prop)**
→ `grepai_refs_readers` / `grepai_refs_writers`

**Architectural overview OR search touching 3+ files**
→ Dispatch subagent `scout` (model: haiku). NEVER do this in the main session.
→ See dispatch template below.

**File already located, needs to be edited**
→ Targeted `Read` with `offset`/`limit` on the relevant section.
→ Full Read is OK only if file < 300 lines.

**Command output > 20 lines (tests, build, logs)**
→ `ctx_batch_execute` (context-mode MCP) if installed.
→ Without context-mode: filter at the source — `head`, `grep`, `--quiet`/`--reporter=dot` flags. Never dump raw output into context.

**External library docs**
→ context7 if installed: `resolve-library-id` → `query-docs`.
→ Without context7: WebFetch the official docs page directly. WebSearch only as last resort.

---

## Scout Dispatch Template

```
Subagent type: scout (fallback: general-purpose with model haiku)
Prompt:
  Find [specific thing] in this codebase.
  Rules:
  - Report conclusions with path:line references.
  - Max 40 lines total response.
  - Answer the specific question only.
  - Do NOT paste file contents.
  - Do NOT list every file you visited.
  - Do NOT summarize unrelated code.
```

---

## Effective grepai Queries

Use natural language for **intent**, not keywords.

| Good | Bad |
|------|-----|
| `where is the density toggle state persisted` | `density` |
| `how does the inspector panel open from the view header` | `inspector open` |

If results seem stale: run `grepai_index_status` first — if index is outdated, re-index before trusting results.

---

## When Direct Read IS Optimal

- File < 300 lines and already located by a prior search.
- File you are about to edit (Read before Edit is required).
- Short config files (JSON, YAML, env templates) where full content is the point.

**Rule: locate first, read surgical.** Not "never read."
