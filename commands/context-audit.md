---
description: Audit how much input-token bloat the read-guard removes on this repo
---

Run the input-bloat benchmark against the current working directory and report
the result. This is the input-side analogue of a code audit: it measures the
tokens an agent would waste blindly reading oversized files here, and how much
the read-guard cuts.

Steps:

1. Run the scorer on the current repo:

   !`node "${CLAUDE_PLUGIN_ROOT}/benchmarks/score.mjs" --dir "$(pwd)"`

2. Read its output and report, in at most six lines:
   - the cut ratio (baseline vs guarded input tokens),
   - how many text files are over the 600-line / 256 KB limit,
   - the top 3 offenders (file, line count, tokens saved).

3. One closing line of judgement:
   - cut near 0% → "Already lean on read-bloat. The guard has little to do here."
   - cut meaningful → name the worst offender and note the guard forces a
     targeted Read or a `scout` dispatch instead of reading it whole.

Change nothing. This is a read-only report; do not edit files or persist state.
The full numbers are written to `benchmarks/results/<date>.md` by the scorer.
