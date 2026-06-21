# Benchmarks

Token-economy-kit cuts **input-side** context bloat: the tokens an agent burns
*reading* a codebase before it acts. This harness measures that, deterministically,
with no API calls.

## What it measures

The `read-guard` hook is a pure function of a file's size: any blind Read of a
text file over 600 lines (or 256 KB) is denied, forcing a targeted
`offset`/`limit` Read or a `scout` dispatch instead. So the saving is not a
behavioural guess — it is a counting exercise over a real file corpus:

> For every file an agent might blindly Read, how many input tokens does a
> full Read cost, and how many does the guarded path cost instead?

- **baseline**: agent reads each candidate file in full (the common failure mode).
- **guarded**: files within the limit read in full; files over the limit read as
  a single targeted slice (`limit = 600` lines) — the behaviour the hook forces.

Token estimate: `ceil(bytes / 4)` (the standard ~4 bytes/token approximation).
It is an estimate, stated as one; the *ratio* between arms is what the harness
reports and that ratio is robust to the constant.

## Run it

```
npm run bench            # scores the corpus, writes results/<date>.md
node benchmarks/score.mjs --dir <path>   # score any directory instead
```

By default it scores this repo plus `tasks.json` (a list of real public files).
Nothing here calls a model; it is reproducible and runs in CI.

## Honesty notes

- This measures the *ceiling* the guard removes (blind full Reads), not average
  agent behaviour. An agent that already reads narrowly saves nothing here — and
  that is the correct result, not a flaw.
- It does not measure output-side savings (code written). That is a different
  problem, solved by a different tool (e.g. ponytail). The two are complementary.
- The guarded arm assumes one 600-line slice suffices. If a task needs several
  slices the real saving is smaller; `score.mjs` reports slices-needed so the
  number stays falsifiable.
