// Tests for benchmarks/score.mjs
// Runs the benchmark as a subprocess on temp corpora; never with --out, so
// nothing is written into the repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCORE = join(ROOT, 'benchmarks', 'score.mjs');

const dir = mkdtempSync(join(tmpdir(), 'score-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

// Env without threshold overrides from the developer's shell.
function cleanEnv() {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: join(dir, 'plugin-data') };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_PLUGIN_OPTION_')) delete env[k];
  delete env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS;
  return env;
}

function score(args, cwd = dir) {
  const r = spawnSync(process.execPath, [SCORE, ...args], { encoding: 'utf8', cwd, env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// `lines` lines of `width` bytes each, newline included.
function writeLines(p, lines, width = 100) {
  writeFileSync(p, Array.from({ length: lines }, (_, i) => `line ${i} `.padEnd(width - 1, 'x')).join('\n') + '\n');
}

// A corpus: small.txt (2,500 tokens), big.txt (over budget), plus skipped entries.
function corpus(name) {
  const c = join(dir, name);
  mkdirSync(join(c, 'node_modules'), { recursive: true });
  writeLines(join(c, 'small.txt'), 100);
  writeLines(join(c, 'big.txt'), 3000);
  writeLines(join(c, 'node_modules', 'dep.js'), 3000);
  writeFileSync(join(c, 'image.png'), 'x'.repeat(300 * 1024));
  return c;
}

test('baseline is the capped blind Read, guarded is one slice for files over budget', () => {
  const out = score(['--dir', corpus('walk')]);
  assert.match(out, /`walk` — 2 text files \(directory walk\), 1 over the budget/);
  // big.txt: first 2000 lines = 50,000 tokens, capped at 25,000; slice = 600 lines = 15,000.
  assert.match(out, /baseline \(blind Reads\) \| 27,500 \|/);
  assert.match(out, /guarded \(read-guard active\) \| 17,500 \|/);
  assert.match(out, /\*\*36\.4%\*\*/);
  assert.match(out, /- `big.txt` — 25,000 → 15,000/);
  assert.match(out, /capped at 25,000 tokens/);
});

test('default corpus is the cwd and nothing is written without --out', () => {
  const results = join(ROOT, 'benchmarks', 'results');
  const before = readdirSync(results);
  const c = corpus('cwd-corpus');
  const out = score([], c);
  assert.match(out, new RegExp('`' + basename(c) + '` — 2 text files'));
  assert.doesNotMatch(out, /Written:/);
  assert.deepEqual(readdirSync(results), before);
});

test('in a git repo only tracked files count; unreadable ones are skipped', () => {
  const c = corpus('repo');
  const git = (...a) => spawnSync('git', a, { cwd: c, encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  writeLines(join(c, 'gone.txt'), 10);
  assert.equal(git('add', 'small.txt', 'gone.txt').status, 0);
  rmSync(join(c, 'gone.txt'));
  const out = score(['--dir', c]);
  assert.match(out, /`repo` — 1 text files \(git ls-files\), 0 over the budget/);
  assert.match(out, /baseline \(blind Reads\) \| 2,500 \|/);
});
