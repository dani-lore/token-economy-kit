// Deterministic input-bloat benchmark for the read-guard hook.
// No API calls. Counts the input tokens blind Reads of a corpus cost vs the
// guarded path the hook forces. See benchmarks/README.md for the method.
//
//   node benchmarks/score.mjs [--dir <path>] [--out]
//
// --dir defaults to the cwd; --out also writes benchmarks/results/<date>.md.

import { readFileSync, statSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, relative, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  READ_BUDGET, SLICE_MAX_LINES, NATIVE_READ_LINES, NATIVE_READ_CAP, SKIP_EXTS,
  tokens, blindReadCost, sliceCost,
} from '../hooks/limits.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next']);

function walk(dir, root = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...walk(p, root));
    } else {
      out.push(relative(root, p));
    }
  }
  return out;
}

// Tracked files when `dir` is a git repo (with any), else a directory walk.
function listFiles(dir) {
  const git = spawnSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8' });
  const tracked = git.status === 0 ? git.stdout.split('\0').filter(Boolean) : [];
  const source = tracked.length ? 'git ls-files' : 'directory walk';
  const files = (tracked.length ? tracked : walk(dir))
    .filter((f) => !SKIP_EXTS.has(extname(f).toLowerCase()));
  return { source, files };
}

// Tokens of a blind Read vs the guarded path; null if the file can't be read.
function scoreFile(dir, rel) {
  try {
    const p = join(dir, rel);
    if (!statSync(p).isFile()) return null;
    const bytes = readFileSync(p);
    const text = bytes.toString('utf8');
    const baseline = blindReadCost(text);
    const guarded = tokens(bytes.length) > READ_BUDGET;
    return { rel, baseline, guarded, cost: guarded ? sliceCost(text) : baseline };
  } catch {
    return null;
  }
}

function scoreDir(dir) {
  const { source, files } = listFiles(dir);
  const rows = files.map((f) => scoreFile(dir, f)).filter(Boolean);
  const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
  return { dir, source, rows, baseline: sum('baseline'), guarded: sum('cost') };
}

function report(res, date) {
  const { baseline, guarded, rows } = res;
  const over = rows.filter((r) => r.guarded);
  const cut = baseline ? (1 - guarded / baseline) * 100 : 0;
  const top = [...over].sort((a, b) => (b.baseline - b.cost) - (a.baseline - a.cost)).slice(0, 10);
  const lines = [
    `# Input-bloat benchmark — ${date}`,
    '',
    `Corpus: \`${basename(resolve(res.dir))}\` — ${rows.length} text files (${res.source}), ${over.length} over the budget.`,
    '',
    '| arm | input tokens (est.) |',
    '|---|--:|',
    `| baseline (blind Reads) | ${baseline.toLocaleString('en-US')} |`,
    `| guarded (read-guard active) | ${guarded.toLocaleString('en-US')} |`,
    `| **cut** | **${cut.toFixed(1)}%** |`,
    '',
  ];
  if (top.length) {
    lines.push('Biggest savings (file: baseline → guarded tokens):', '');
    for (const r of top) {
      lines.push(`- \`${r.rel.replace(/\\/g, '/')}\` — ${r.baseline.toLocaleString('en-US')} → ${r.cost.toLocaleString('en-US')}`);
    }
    lines.push('');
  }
  lines.push(
    `Model: a blind Read returns the first ${NATIVE_READ_LINES} lines, capped at ` +
    `${NATIVE_READ_CAP.toLocaleString('en-US')} tokens (native Read limits). Files estimated over ` +
    `${READ_BUDGET.toLocaleString('en-US')} tokens are denied and cost one ${SLICE_MAX_LINES}-line ` +
    'slice under the same cap instead. Token estimate: ceil(bytes/4).',
  );
  return { text: lines.join('\n'), cut };
}

// --- main ---
const args = process.argv.slice(2);
const dirArg = args.indexOf('--dir');
const target = dirArg !== -1 ? args[dirArg + 1] : process.cwd();
const date = new Date().toISOString().slice(0, 10);
const { text, cut } = report(scoreDir(target), date);

console.log(text);
if (args.includes('--out')) {
  const outDir = join(HERE, 'results');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${date}.md`);
  writeFileSync(outFile, text + '\n');
  console.log(`\nWritten: ${outFile}`);
}
console.log(`Cut: ${cut.toFixed(1)}%`);
