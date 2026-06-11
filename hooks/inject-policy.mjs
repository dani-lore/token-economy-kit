// SessionStart hook: injects token economy policy into session context.
// Claude Code captures stdout from SessionStart hooks as context.

process.stdout.write(`=== Token Economy policy (plugin) ===
Locate, don't read. Mandatory order:
1. Locating code -> grepai_search / grepai_trace_* (if indexed), else Grep/Glob. Never exploratory Read.
2. Read only to act (Edit / targeted verification) and only narrow: offset/limit. Full Read of files >600 lines is blocked by hook.
3. Broad exploration (architecture, "where is X", 3+ files) -> \`scout\` subagent: returns conclusions, not dumps.
4. Command output >20 lines -> context-mode if installed, else filter at the source (head, grep, targeted flags). Library docs -> context7 if installed, else WebFetch the official docs page.
5. Detailed protocol: skill \`exploring-codebase\`.
`);
