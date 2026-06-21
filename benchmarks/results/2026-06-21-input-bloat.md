# Input-bloat benchmark — 2026-06-21

Measures the input tokens `read-guard` removes by forcing targeted Reads on
oversized files, vs a baseline that blindly Reads each file in full. Method and
honesty notes: [benchmarks/README.md](../README.md). Token estimate `ceil(bytes/4)`;
the reported figure is the cut ratio between arms.

Reproduce: `node benchmarks/score.mjs --dir <cloned-repo>`.

## Results

| corpus | text files | over limit | baseline tokens | guarded tokens | cut |
|---|--:|--:|--:|--:|--:|
| this repo (token-economy-kit) | 18 | 0 | 13,832 | 13,832 | **0.0%** |
| [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) | 213 | 2 | 155,699 | 146,165 | **6.1%** |
| [microsoft/vscode-python](https://github.com/microsoft/vscode-python) | 1,415 | 42 | 2,282,171 | 1,659,753 | **27.3%** |

## Reading the numbers

The saving scales with how much oversized material the corpus carries, and the
harness reports that honestly rather than quoting a single flattering figure:

- **0%** on this repo — every file is already under the limit, so the guard has
  nothing to cut. The correct result, not a failure.
- **6.1%** on a clean, well-maintained app template (fastapi) — only 2 files of
  213 trip the limit (a release-notes file and one large UI component).
- **27.3%** on a real mid-size codebase (vscode-python) — 42 oversized files,
  dominated by generated/aggregate files an agent should never read in full:
  `package-lock.json` (303,695 → 6,708 tokens) and `CHANGELOG.md`
  (156,269 → 7,201).

## Scope and limits

- This is the **input** side only (tokens spent *reading*). Output-side savings
  (code written) are a separate problem for a separate tool.
- It measures the ceiling the guard removes — blind full Reads. An agent that
  already reads narrowly saves nothing here, and the harness will correctly
  report ~0%.
- The guarded arm assumes one 600-line slice per oversized file suffices. A task
  needing several slices saves less; the metric stays falsifiable because
  slice count is visible per file.
