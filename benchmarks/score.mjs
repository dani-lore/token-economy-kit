// Deterministic input-bloat benchmark for the read-guard hook.
// No API calls. Counts the input tokens a blind full-Read corpus costs vs the
// guarded path the hook forces. See benchmarks/README.md for the method.

import { readFileSync, statSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Same thresholds the hook enforces. Keep in sync with hooks/read-guard.mjs.
const MAX_LINES = 600;
const MAX_BYTES = 262144;
const BINARY_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.bmp','.pdf','.ipynb',
  '.zip','.gz','.7z','.exe','.dll','.node','.wasm','.woff','.woff2','.ttf',
  '.eot','.mp3','.mp4','.mov','.avi','.db','.sqlite','.sqlite3','.lock',
]);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next']);

const tokens = (bytes) => Math.ceil(bytes / 4);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...walk(join(dir, e.name)));
    } else if (!BINARY_EXTS.has(extname(e.name).toLowerCase())) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

// Score one file: bytes a baseline blind Read costs vs the guarded path.
function scoreFile(path) {
  const { size } = statSync(path);
  const content = readFileSync(path, 'utf8');
  const lines = (content.match(/\n/g) ?? []).length + (content.endsWith('\n') ? 0 : 1);
  const over = lines > MAX_LINES || size > MAX_BYTES;

  // Guarded: within limits -> full read; over -> one 600-line slice.
  let guardedBytes = size;
  if (over) {
    const slice = content.split('\n').slice(0, MAX_LINES).join('\n');
    guardedBytes = Buffer.byteLength(slice, 'utf8');
  }
  return { path, lines, baselineBytes: size, guardedBytes, guarded: over };
}

function scoreDir(dir) {
  const rows = walk(dir).map(scoreFile);
  const baseline = rows.reduce((a, r) => a + tokens(r.baselineBytes), 0);
  const guarded = rows.reduce((a, r) => a + tokens(r.guardedBytes), 0);
  const guardedFiles = rows.filter((r) => r.guarded);
  return { dir, rows, baseline, guarded, guardedFiles };
}

function report(res) {
  const { baseline, guarded, guardedFiles, rows } = res;
  const cut = baseline ? (1 - guarded / baseline) * 100 : 0;
  const top = [...guardedFiles]
    .sort((a, b) => (b.baselineBytes - b.guardedBytes) - (a.baselineBytes - a.guardedBytes))
    .slice(0, 10);

  const lines = [];
  lines.push(`# Input-bloat benchmark — ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`Corpus: \`${res.dir}\` — ${rows.length} text files, ${guardedFiles.length} over the guard limit.`);
  lines.push('');
  lines.push('| arm | input tokens (est.) |');
  lines.push('|---|--:|');
  lines.push(`| baseline (blind full Reads) | ${baseline.toLocaleString()} |`);
  lines.push(`| guarded (read-guard active) | ${guarded.toLocaleString()} |`);
  lines.push(`| **cut** | **${cut.toFixed(1)}%** |`);
  lines.push('');
  if (top.length) {
    lines.push('Biggest savings (file: baseline → guarded tokens):');
    lines.push('');
    for (const r of top) {
      lines.push(`- \`${r.path.replace(res.dir, '.').replace(/\\/g, '/')}\` — ${r.lines} lines, ${tokens(r.baselineBytes).toLocaleString()} → ${tokens(r.guardedBytes).toLocaleString()}`);
    }
    lines.push('');
  }
  lines.push('Token estimate: ceil(bytes/4). The cut ratio is the reported figure.');
  return { text: lines.join('\n'), cut };
}

// --- main ---
const dirArg = process.argv.indexOf('--dir');
const target = dirArg !== -1 ? process.argv[dirArg + 1] : ROOT;
const res = scoreDir(target);
const { text, cut } = report(res);

const outDir = join(HERE, 'results');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${new Date().toISOString().slice(0, 10)}.md`);
writeFileSync(outFile, text + '\n');

console.log(text);
console.log(`\nWritten: ${outFile.replace(ROOT, '.')}`);
console.log(`Cut: ${cut.toFixed(1)}%`);
