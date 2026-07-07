---
description: Report realized read-guard savings observed on this repo (from denied.jsonl)
---

Report the token savings the read-guard has *actually* realized on this repo,
as opposed to `/context-audit`'s static ceiling. Every deny the guard fires
(`hooks/read-guard.mjs`) appends one JSON line to
`.claude/token-economy/denied.jsonl` in the current working directory, at the
moment it denies a Read or a shell dump — this command just reads that log.

Steps:

1. Check whether `.claude/token-economy/denied.jsonl` exists in `$(pwd)`.
   If it doesn't, say so plainly: "No denies logged yet — the guard hasn't
   fired on this repo." Stop there.

2. If it exists, parse it (one JSON object per line: `{ t, tool, path, lines,
   bytes, saved }`) and report, in at most six lines:
   - total estimated tokens avoided (sum of `saved`),
   - number of deny events logged,
   - top 3 offenders by `saved` (path, lines, tokens saved).

   A one-liner to sum it, matching how `/context-audit` invokes the scorer:

   !`node -e "const fs=require('fs');const p='.claude/token-economy/denied.jsonl';if(!fs.existsSync(p)){console.log('no log');process.exit(0)};const rows=fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);console.log('events:',rows.length,'saved:',rows.reduce((a,r)=>a+r.saved,0));console.log(rows.sort((a,b)=>b.saved-a.saved).slice(0,3))"`

3. One closing line of judgement, and one line of caveat:
   - judgement: if events are few/near-zero, "the guard rarely fires here";
     if events are frequent, name the worst-offending path and suggest it be
     read via `offset`/`limit` or handed to a `scout` dispatch instead.
   - caveat, state clearly: `saved` is a **ceiling**, not a measured actual —
     it assumes the agent would otherwise have blindly read the whole file.
     A real agent might have used `offset`/`limit` or a subagent anyway, so
     treat this number as an upper bound on waste avoided, not a guarantee.

Change nothing. This is a read-only report; do not edit files, do not modify
or truncate `denied.jsonl`, do not persist new state.
