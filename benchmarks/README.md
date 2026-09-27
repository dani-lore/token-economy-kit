# Benchmarks

Token-economy-kit cuts **input-side** context bloat: the tokens an agent burns
*reading* a codebase before it acts. This harness measures that, deterministically,
with no API calls.

## What it measures

The `read-guard` hook is a pure function of a file's size: a Read without a
`limit` of at most 600 lines is denied when the file is estimated over the token
budget (`read_budget`, default 10,000), forcing a targeted `offset`/`limit`
Read instead. So the saving is not a behavioural guess — it is a counting
exercise over a real file corpus:

> For every file an agent might blindly Read, how many input tokens does that
> Read cost, and how many does the guarded path cost instead?

- **baseline**: the agent reads each file without `offset`/`limit`.
- **guarded**: files within the budget cost the same; files over it cost a
  single targeted slice (`limit = 600` lines) — the behaviour the hook forces.

## Native Read caps

A blind Read is not unbounded: Claude Code's Read returns at most the first
2,000 lines, and truncates output over a token cap (25,000 by default,
`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`; the scorer uses the default). Both arms apply those caps, so the
baseline is what a blind Read actually costs, not the size of the file on disk:

| | lines | token cap |
|---|--:|--:|
| baseline (blind Read) | first 2,000 | 25,000 |
| guarded, file over budget | first 600 | 25,000 |
| guarded, file within budget | as baseline | as baseline |

The thresholds come from `hooks/limits.mjs`, the same module the hook imports,
so the benchmark always measures the guard that actually ships. Token estimate:
`ceil(bytes / 4)` (the standard ~4 bytes/token approximation). It is an
estimate, stated as one; the *ratio* between arms is what the harness reports
and that ratio is robust to the constant.

## Run it

```
npm run bench                            # scores this repo, writes results/<date>.md
node benchmarks/score.mjs --dir <path>   # score any directory, print only
node benchmarks/score.mjs --dir <path> --out
```

The corpus is the current directory unless `--dir` is given. In a git repo the
file list is `git ls-files` (tracked files only); elsewhere it is a directory walk
that skips `.git`, `node_modules`, `dist`, `build` and `.next`. Binary and media
extensions are skipped in both cases, and a file that cannot be read is left out.
The report goes to stdout; it is written to `results/<date>.md` (gitignored) only
with `--out`. Curated reports with a different name, such as
`results/2026-09-27-input-bloat.md`, are kept in the repo.

## Honesty notes

- This measures the *ceiling* the guard removes (blind Reads of every file),
  not average agent behaviour. An agent that already reads narrowly saves
  nothing here — and that is the correct result, not a flaw.
- The guarded arm assumes one 600-line slice suffices. If a task needs several
  slices the real saving is smaller.
- A file with very long lines can hit the token cap in both arms and save
  nothing (see `uv.lock` in the curated results).
- It does not measure output-side savings (code written). That is a different
  problem, solved by a different tool. The two are complementary.
