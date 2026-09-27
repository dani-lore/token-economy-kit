# Input-bloat benchmark — 2026-09-27

Measures the input tokens `read-guard` removes by forcing targeted Reads on files
over the token budget, vs a baseline that Reads each file without `offset`/`limit`.
Method, native Read caps and honesty notes: [benchmarks/README.md](../README.md).
Default settings: budget 10,000 tokens, slice 600 lines, blind Read capped at
2,000 lines and 25,000 tokens. Token estimate `ceil(bytes/4)`; the reported
figure is the cut ratio between arms.

Reproduce: `git clone --depth 1 <repo>` then `node benchmarks/score.mjs --dir <clone>`.

## Results

| corpus | commit | text files | over budget | baseline tokens | guarded tokens | cut |
|---|---|--:|--:|--:|--:|--:|
| this repo (token-economy-kit) | this commit | 32 | 0 | 31,771 | 31,771 | **0.0%** |
| [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) | `cb740b6` | 238 | 3 | 211,416 | 202,719 | **4.1%** |
| [microsoft/vscode-python](https://github.com/microsoft/vscode-python) | `70f695e` | 1,464 | 20 | 1,958,275 | 1,772,889 | **9.5%** |

## Reading the numbers

The saving scales with how much oversized material the corpus carries:

- **0%** on this repo — every file is under the budget, so the guard has nothing
  to cut. The correct result, not a failure.
- **4.1%** on a clean app template (fastapi) — 3 files of 238 go over the budget:
  `bun.lock` (25,000 → 20,180 tokens), `release-notes.md` (25,000 → 21,123) and
  `uv.lock` (25,000 → 25,000: its lines are so long that 600 of them still hit the
  token cap, so the guard saves nothing there).
- **9.5%** on a mid-size codebase (vscode-python) — 20 files over the budget,
  led by `src/client/telemetry/index.ts` (24,444 → 6,106), `CHANGELOG.md`
  (25,000 → 7,201), a generated test fixture (24,708 → 7,158) and
  `package-lock.json` (22,427 → 6,653).

## Compared with the 2026-06-21 report

That report quoted 6.1% and 27.3% for the same two corpora (older commits). Most
of the difference is the method: the old baseline counted every file in full
(`package-lock.json` at 303,695 tokens), while a blind Read never returns more
than 2,000 lines or 25,000 tokens. The guard changed too, from 600 lines or
256 KB to a token budget. With both arms capped the way the native Read is, the
removable ceiling is smaller, and these are the figures to quote.

## Scope and limits

- Input side only (tokens spent *reading*); output-side savings are a separate
  problem.
- It measures the ceiling the guard removes — blind Reads of every file. An agent
  that already reads narrowly saves nothing here.
- The guarded arm assumes one 600-line slice per oversized file suffices; a task
  needing several slices saves less.
