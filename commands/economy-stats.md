---
description: Report realized read-guard savings logged at deny time
allowed-tools: Bash(node *)
disable-model-invocation: true
---

Report the token savings the read-guard has actually logged, as opposed to
`/context-audit`'s static ceiling. Each deny appends one record to `denied.jsonl`
in the plugin data directory; this summary covers the current project and all
projects:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/economy-stats.mjs" "${CLAUDE_PLUGIN_DATA}"`

Relay the summary in at most six lines. If it says no denies are logged, say so
plainly and stop. Otherwise add one closing line of judgement: few events → "the
guard rarely fires here"; frequent events → name the worst path and suggest
reading it with `offset`/`limit` or through the Explore subagent.

State the caveat clearly: tokens avoided are a **ceiling**, not a measured
actual. They assume the agent would otherwise have read the whole file.

Change nothing: do not edit files, do not modify or truncate `denied.jsonl`.
