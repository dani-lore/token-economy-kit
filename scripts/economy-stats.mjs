// Summary of the read-guard deny log for /economy-stats.
//
//   node scripts/economy-stats.mjs [dataDir]
//
// dataDir is the plugin data dir; empty or an unsubstituted `${...}` falls back
// to the hook's log dir. The current project is CLAUDE_PROJECT_DIR or the cwd.

import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logDir } from '../hooks/limits.mjs';

const arg = process.argv[2];
const dir = arg && !arg.includes('${') ? arg : logDir();
const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Symlinks resolved (e.g. macOS /var → /private/var); Windows paths compare case-insensitively.
function norm(p) {
  let r = resolve(p);
  try { r = realpathSync(r); } catch { /* project dir gone: compare as logged */ }
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function readRecords(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    try {
      const r = JSON.parse(line);
      if (r && typeof r.saved === 'number') rows.push(r);
    } catch { /* skip blank or malformed lines */ }
  }
  return rows;
}

const total = (rows) => rows.reduce((a, r) => a + r.saved, 0).toLocaleString('en-US');

// Paths with the most tokens avoided, summed over repeated denies.
function worst(rows, n = 3) {
  const byPath = new Map();
  for (const r of rows) {
    const e = byPath.get(r.path) ?? { saved: 0, count: 0 };
    byPath.set(r.path, { saved: e.saved + r.saved, count: e.count + 1 });
  }
  return [...byPath].sort((a, b) => b[1].saved - a[1].saved).slice(0, n);
}

const rows = readRecords(join(dir, 'denied.jsonl'));
if (!rows.length) {
  console.log('No denies logged yet.');
  process.exit(0);
}

const here = rows.filter((r) => r.project && norm(r.project) === norm(project));
if (here.length) {
  console.log(`This project (${project}): ${here.length} denies, up to ${total(here)} tokens avoided.`);
  console.log('Worst paths:');
  for (const [path, e] of worst(here)) {
    console.log(`- ${path}: up to ${e.saved.toLocaleString('en-US')} tokens (${e.count} denies)`);
  }
} else {
  console.log(`This project (${project}): no denies logged yet.`);
}
console.log(`All projects: ${rows.length} denies, up to ${total(rows)} tokens avoided.`);
console.log('Tokens avoided are a ceiling: they assume each denied Read would have read the whole file.');
