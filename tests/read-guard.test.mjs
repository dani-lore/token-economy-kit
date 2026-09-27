// Tests for hooks/read-guard.mjs
// Contract: allow = exit 0 + empty stdout; deny = exit 0 + JSON on stdout.
// Runs the hook as a subprocess (as Claude Code does), feeding JSON on stdin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'read-guard.mjs');

const dir = mkdtempSync(join(tmpdir(), 'read-guard-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

// Default telemetry dir for every spawn: nothing ever lands in ~/.claude.
const dataDir = join(dir, 'plugin-data');

// Hook env: temp plugin data dir, no plugin options or project dir leaking in
// from the developer's shell.
function hookEnv(extra = {}) {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, ...extra };
  for (const k of Object.keys(env)) {
    if (k.startsWith('CLAUDE_PLUGIN_OPTION_') && !(k in extra)) delete env[k];
  }
  if (!('CLAUDE_PROJECT_DIR' in extra)) delete env.CLAUDE_PROJECT_DIR;
  return env;
}

// Run the hook with a payload object, return { stdout, code, decision }.
// cwd is a temp dir too, so a stray write into the cwd stays out of the repo.
function runHook(payload, { cwd = dir, env = {} } = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd,
    env: hookEnv(env),
  });
  let decision = null;
  const out = r.stdout.trim();
  if (out) {
    try { decision = JSON.parse(out).hookSpecificOutput?.permissionDecision; } catch { /* leave null */ }
  }
  return { stdout: out, code: r.status, decision };
}

// A temp file of `lines` lines, each `width` bytes including the newline.
// Default width 100 → 400 lines = 10000 tokens, the default budget.
function makeFile(name, lines, width = 100, at = dir) {
  const p = join(at, name);
  writeFileSync(p, Array.from({ length: lines }, (_, i) => `line ${i} `.padEnd(width - 1, 'x')).join('\n') + '\n');
  return p;
}

const read = (file_path, extra = {}) => ({ tool_name: 'Read', tool_input: { file_path, ...extra } });

test('non-Read tool passes through, shell dumps included', () => {
  const big = makeFile('cat-big.txt', 3000);
  for (const payload of [
    { tool_name: 'Edit', tool_input: { file_path: big } },
    { tool_name: 'Bash', tool_input: { command: `cat ${big}` } },
  ]) {
    const { stdout, code } = runHook(payload);
    assert.equal(stdout, '');
    assert.equal(code, 0);
  }
});

test('malformed stdin is allowed (fail-open)', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8', cwd: dir, env: hookEnv() });
  assert.equal(r.stdout.trim(), '');
  assert.equal(r.status, 0);
});

test('UTF-8 BOM prefixed payload still parses', () => {
  const big = makeFile('bom.txt', 3000);
  const r = spawnSync(process.execPath, [HOOK], {
    input: '﻿' + JSON.stringify(read(big)),
    encoding: 'utf8',
    cwd: dir,
    env: hookEnv(),
  });
  assert.match(r.stdout, /"deny"/);
});

test('small file blind Read is allowed', () => {
  assert.equal(runHook(read(makeFile('small.txt', 100))).decision, null);
});

test('900 short lines are allowed: the budget is tokens, not lines', () => {
  assert.equal(runHook(read(makeFile('short-lines.txt', 900, 10))).decision, null);
});

test('file exactly at the token budget is allowed', () => {
  assert.equal(runHook(read(makeFile('edge.txt', 400))).decision, null);
});

test('file over the token budget is denied with tokens and lines', () => {
  const { decision, stdout, code } = runHook(read(makeFile('big.txt', 401)));
  assert.equal(decision, 'deny');
  assert.equal(code, 0);
  assert.match(stdout, /~10025 tokens \(401 lines\)/);
  assert.match(stdout, /capped at 10000 tokens/);
  assert.match(stdout, /offset\/limit/);
});

test('few very long lines are denied on tokens', () => {
  const p = join(dir, 'dense.min.js');
  writeFileSync(p, Array.from({ length: 50 }, () => 'y'.repeat(2000)).join('\n'));
  assert.equal(runHook(read(p)).decision, 'deny');
});

test('limit 600 is allowed regardless of size', () => {
  const big = makeFile('limit-600.txt', 5000);
  assert.equal(runHook(read(big, { limit: 600 })).decision, null);
  assert.equal(runHook(read(big, { offset: 10, limit: 50 })).decision, null);
});

test('limit 601 on a large file is denied', () => {
  assert.equal(runHook(read(makeFile('limit-601.txt', 5000), { limit: 601 })).decision, 'deny');
});

test('offset without limit on a large file is denied', () => {
  assert.equal(runHook(read(makeFile('offset.txt', 5000), { offset: 10 })).decision, 'deny');
});

test('large .lock file is denied (no longer skipped)', () => {
  assert.equal(runHook(read(makeFile('package.lock', 3000))).decision, 'deny');
});

test('binary extension is allowed even when large', () => {
  const p = join(dir, 'image.png');
  writeFileSync(p, 'x'.repeat(300 * 1024));
  assert.equal(runHook(read(p)).decision, null);
});

test('non-existent file and directory are allowed (fail-open)', () => {
  assert.equal(runHook(read(join(dir, 'nope.txt'))).decision, null);
  const sub = join(dir, 'a-directory');
  mkdirSync(sub, { recursive: true });
  assert.equal(runHook(read(sub)).decision, null);
});

test('budget is overridable via CLAUDE_PLUGIN_OPTION_READ_BUDGET', () => {
  const big = makeFile('override.txt', 1000); // ~25000 tokens
  const env = { CLAUDE_PLUGIN_OPTION_READ_BUDGET: '30000' };
  assert.equal(runHook(read(big), { env }).decision, null);
  const low = runHook(read(makeFile('override-low.txt', 100)), { env: { CLAUDE_PLUGIN_OPTION_READ_BUDGET: '1000' } });
  assert.equal(low.decision, 'deny');
  assert.match(low.stdout, /capped at 1000 tokens/);
});

test('invalid budget override falls back to the default', () => {
  const big = makeFile('override-bad.txt', 401);
  for (const v of ['abc', '0', '-5']) {
    assert.equal(runHook(read(big), { env: { CLAUDE_PLUGIN_OPTION_READ_BUDGET: v } }).decision, 'deny');
  }
});

test('file over the 2 MB prefix is denied without a line count', () => {
  const p = join(dir, 'huge.txt');
  writeFileSync(p, 'x'.repeat(3 * 1024 * 1024));
  const { decision, stdout } = runHook(read(p));
  assert.equal(decision, 'deny');
  assert.match(stdout, /~786432 tokens;/);
  assert.doesNotMatch(stdout, /lines\)/);
});

// --- outline in the deny message ---

// A large file with `marks` placed at given 1-based line numbers over filler.
function withMarks(name, total, marks) {
  const lines = Array.from({ length: total }, (_, i) => `  // filler ${i} `.padEnd(99, '.'));
  for (const [n, text] of Object.entries(marks)) lines[n - 1] = text;
  const p = join(dir, name);
  writeFileSync(p, lines.join('\n'));
  return p;
}

const reasonOf = (stdout) => JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason;

test('deny lists column-0 declarations of a .js file with line numbers', () => {
  const p = withMarks('outline.js', 1000, {
    1: "import x from 'y';",
    10: 'export function alpha() {',
    200: 'class Beta {',
    201: '  method() {',
    300: 'export default async function gamma() {',
    450: 'const delta = 1;',
    600: `export const ${'long'.repeat(40)} = 2;`,
  });
  const reason = reasonOf(runHook(read(p)).stdout);
  const outline = reason.split('Outline:\n')[1].split('\n');
  assert.deepEqual(outline.slice(0, 4), [
    'L10 export function alpha() {',
    'L200 class Beta {',
    'L300 export default async function gamma() {',
    'L450 const delta = 1;',
  ]);
  assert.equal(outline[4], `L600 ${`export const ${'long'.repeat(40)}`.slice(0, 80)}`);
  assert.equal(outline.length, 5);
});

test('deny lists markdown headings up to level 3', () => {
  const p = withMarks('outline.md', 1000, {
    1: '# Title',
    50: '## Section',
    100: '### Sub',
    150: '#### Too deep',
    200: '#hashtag',
  });
  const reason = reasonOf(runHook(read(p)).stdout);
  assert.match(reason, /Outline:\nL1 # Title\nL50 ## Section\nL100 ### Sub$/);
});

test('outline caps at 30 entries', () => {
  const marks = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [i * 10 + 1, `def f${i}():`]));
  const reason = reasonOf(runHook(read(withMarks('outline.py', 1000, marks))).stdout);
  const outline = reason.split('Outline:\n')[1].split('\n');
  assert.equal(outline.length, 31);
  assert.equal(outline[29], 'L291 def f29():');
  assert.equal(outline[30], '… 5 more');
});

test('no outline section without matches', () => {
  const reason = reasonOf(runHook(read(makeFile('plain.txt', 3000))).stdout);
  assert.doesNotMatch(reason, /Outline/);
});

test('outline beyond 2 MB covers the prefix and says so', () => {
  const p = join(dir, 'huge.ts');
  writeFileSync(p, 'export interface Big {}\n' + 'x'.repeat(3 * 1024 * 1024) + '\nclass Hidden {}\n');
  const reason = reasonOf(runHook(read(p)).stdout);
  assert.match(reason, /Outline \(first 2 MB only\):\nL1 export interface Big \{\}$/);
});

// --- realized-savings telemetry (logged at deny time) ---

// A fresh temp dir used as both session cwd and CLAUDE_PLUGIN_DATA parent.
function withTempDir(prefix, fn) {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  try { fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const lastRecord = (logPath) => JSON.parse(readFileSync(logPath, 'utf8').trim().split('\n').pop());

test('a deny writes a telemetry record to CLAUDE_PLUGIN_DATA/denied.jsonl, nothing in cwd', () => {
  withTempDir('read-guard-tel-', (tmp) => {
    const cwd = join(tmp, 'project');
    const data = join(tmp, 'data');
    mkdirSync(cwd);
    const big = makeFile('big.txt', 3000, 100, tmp);
    const payload = { ...read(big), cwd: join(tmp, 'payload-cwd') };
    assert.equal(runHook(payload, { cwd, env: { CLAUDE_PLUGIN_DATA: data } }).decision, 'deny');

    const record = lastRecord(join(data, 'denied.jsonl'));
    assert.deepEqual(Object.keys(record), ['t', 'project', 'path', 'lines', 'bytes', 'saved']);
    assert.equal(record.project, join(tmp, 'payload-cwd'));
    assert.equal(record.path, big);
    assert.equal(record.lines, 3000);
    assert.equal(record.bytes, 300000);
    // blind read = 25000 (native cap), slice = 600 lines = 15000, minus the message.
    assert.ok(record.saved > 9000 && record.saved < 10000, String(record.saved));
    assert.deepEqual(readdirSync(cwd), []);
  });
});

test('project is CLAUDE_PROJECT_DIR first, process cwd last', () => {
  withTempDir('read-guard-tel-project-', (tmp) => {
    const data = join(tmp, 'data');
    const big = makeFile('big.txt', 3000, 100, tmp);
    const env = { CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: join(tmp, 'proj') };
    runHook({ ...read(big), cwd: join(tmp, 'other') }, { env });
    assert.equal(lastRecord(join(data, 'denied.jsonl')).project, join(tmp, 'proj'));
    runHook(read(big), { cwd: tmp, env: { CLAUDE_PLUGIN_DATA: data } });
    assert.equal(realpathSync(lastRecord(join(data, 'denied.jsonl')).project), realpathSync(tmp));
  });
});

test('saved is never negative', () => {
  withTempDir('read-guard-tel-zero-', (tmp) => {
    const data = join(tmp, 'data');
    const big = makeFile('just-over.txt', 401, 100, tmp);
    assert.equal(runHook(read(big), { env: { CLAUDE_PLUGIN_DATA: data } }).decision, 'deny');
    assert.equal(lastRecord(join(data, 'denied.jsonl')).saved, 0);
  });
});

test('deny still happens (fail-open) when the telemetry log dir cannot be created', () => {
  withTempDir('read-guard-tel-blocked-', (tmp) => {
    // A regular FILE on the way to the data dir makes mkdirSync throw ENOTDIR.
    writeFileSync(join(tmp, 'blocker'), 'not a directory');
    const big = makeFile('big.txt', 3000, 100, tmp);
    const { decision, code } = runHook(read(big), { env: { CLAUDE_PLUGIN_DATA: join(tmp, 'blocker', 'data') } });
    assert.equal(decision, 'deny');
    assert.equal(code, 0);
  });
});
