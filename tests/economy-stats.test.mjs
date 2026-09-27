// Tests for scripts/economy-stats.mjs
// Runs the script as a subprocess against a temp data dir; CLAUDE_PLUGIN_DATA
// always points at a temp dir so the fallback never reads ~/.claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'economy-stats.mjs');

const dir = mkdtempSync(join(tmpdir(), 'economy-stats-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const projA = join(dir, 'project-a');
const projB = join(dir, 'project-b');
mkdirSync(projA);
mkdirSync(projB);

function run(args, { cwd = projA, data = join(dir, 'empty') } = {}) {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd, env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// A data dir holding a denied.jsonl with the given records (and a bad line).
function dataDir(name, records) {
  const d = join(dir, name);
  mkdirSync(d);
  const lines = records.map((r) => JSON.stringify({ t: 1, lines: 10, bytes: 100, ...r }));
  writeFileSync(join(d, 'denied.jsonl'), [...lines, 'not json', ''].join('\n'));
  return d;
}

const logged = dataDir('logged', [
  { project: projA, path: 'a/big.js', saved: 1000 },
  { project: projA, path: 'a/big.js', saved: 1000 },
  { project: projA, path: 'a/huge.json', saved: 5000 },
  { project: projA, path: 'a/mid.md', saved: 300 },
  { project: projA, path: 'a/small.md', saved: 100 },
  { project: projB, path: 'b/other.ts', saved: 9000 },
]);

test('reports the current project, its 3 worst paths and the total', () => {
  const out = run([logged]);
  assert.match(out, /This project \(.*project-a\): 5 denies, up to 7,400 tokens avoided\./);
  const worst = out.split('Worst paths:\n')[1].split('\n').slice(0, 3);
  assert.deepEqual(worst, [
    '- a/huge.json: up to 5,000 tokens (1 denies)',
    '- a/big.js: up to 2,000 tokens (2 denies)',
    '- a/mid.md: up to 300 tokens (1 denies)',
  ]);
  assert.match(out, /All projects: 6 denies, up to 16,400 tokens avoided\./);
  assert.match(out, /ceiling/);
});

test('a project without denies still gets the all-projects total', () => {
  const out = run([logged], { cwd: dir });
  assert.match(out, /This project \(.*\): no denies logged yet\./);
  assert.match(out, /All projects: 6 denies/);
});

test('no log says so', () => {
  assert.equal(run([join(dir, 'missing')]).trim(), 'No denies logged yet.');
});

test('empty or unsubstituted argument falls back to CLAUDE_PLUGIN_DATA', () => {
  for (const args of [[], [''], ['${CLAUDE_PLUGIN_DATA}']]) {
    assert.match(run(args, { data: logged }), /All projects: 6 denies/);
  }
});
