---
description: Audit how much input-token bloat the read-guard removes on this repo
allowed-tools: Bash(node *)
disable-model-invocation: true
---

Report the input-bloat benchmark for the current working directory: the tokens an
agent would spend on blind Reads here, and how much the read-guard cuts.

Scorer output:

!`node "${CLAUDE_PLUGIN_ROOT}/benchmarks/score.mjs"`

From that output, report in at most six lines:
- the cut ratio (baseline vs guarded input tokens),
- how many text files are over the token budget,
- the top 3 offenders (file, baseline → guarded tokens).

Close with one line of judgement:
- cut near 0% → "Already lean on read-bloat. The guard has little to do here."
- cut meaningful → name the worst offender and note that the guard forces an
  `offset`/`limit` slice of it instead of a whole-file Read.

Change nothing: do not edit files or persist state. The figures are a ceiling
(every file read blindly once), as the scorer's model line states.
