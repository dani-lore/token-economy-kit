// Tests for hooks/read-guard.mjs
// Contract: allow = exit 0 + empty stdout; deny = exit 0 + JSON on stdout.
// Runs the hook as a subprocess (as Claude Code does), feeding JSON on stdin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'read-guard.mjs');

const dir = mkdtempSync(join(tmpdir(), 'read-guard-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

// Hook env: no plugin options leaking in from the developer's shell.
function hookEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) {
    if (k.startsWith('CLAUDE_PLUGIN_OPTION_') && !(k in extra)) delete env[k];
  }
  delete env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS;
  return env;
}

// Run the hook with a payload object, return { stdout, code, decision }.
// cwd defaults to the shared temp dir so deny-time telemetry lands there,
// never in the repo root — keeps the whole suite hermetic.
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

test('budget is overridable via CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS', () => {
  const big = makeFile('override.txt', 1000); // ~25000 tokens
  const env = { CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS: '30000' };
  assert.equal(runHook(read(big), { env }).decision, null);
  const low = runHook(read(makeFile('override-low.txt', 100)), { env: { CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS: '1000' } });
  assert.equal(low.decision, 'deny');
  assert.match(low.stdout, /capped at 1000 tokens/);
});

test('invalid budget override falls back to the default', () => {
  const big = makeFile('override-bad.txt', 401);
  for (const v of ['abc', '0', '-5']) {
    assert.equal(runHook(read(big), { env: { CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS: v } }).decision, 'deny');
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

// --- realized-savings telemetry (logged at deny time) ---

test('a deny writes a telemetry record to .claude/token-economy/denied.jsonl', () => {
  const telDir = mkdtempSync(join(tmpdir(), 'read-guard-tel-'));
  try {
    const big = makeFile('big.txt', 3000, 100, telDir);
    assert.equal(runHook(read(big), { cwd: telDir }).decision, 'deny');

    const logPath = join(telDir, '.claude', 'token-economy', 'denied.jsonl');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    for (const k of ['t', 'tool', 'path', 'lines', 'bytes', 'saved']) assert.ok(k in record, k);
    assert.equal(record.tool, 'Read');
    assert.equal(record.lines, 3000);
    // blind read = 25000 (native cap), slice = 600 lines = 15000, minus the message.
    assert.ok(record.saved > 9000 && record.saved < 10000, String(record.saved));
  } finally {
    rmSync(telDir, { recursive: true, force: true });
  }
});

test('saved is never negative', () => {
  const telDir = mkdtempSync(join(tmpdir(), 'read-guard-tel-zero-'));
  try {
    const big = makeFile('just-over.txt', 401, 100, telDir);
    assert.equal(runHook(read(big), { cwd: telDir }).decision, 'deny');
    const record = JSON.parse(readFileSync(join(telDir, '.claude', 'token-economy', 'denied.jsonl'), 'utf8'));
    assert.equal(record.saved, 0);
  } finally {
    rmSync(telDir, { recursive: true, force: true });
  }
});

test('deny still happens (fail-open) when the telemetry log dir cannot be created', () => {
  const telDir = mkdtempSync(join(tmpdir(), 'read-guard-tel-blocked-'));
  try {
    // Pre-create a regular FILE at .claude so mkdirSync(.claude/token-economy) throws ENOTDIR.
    writeFileSync(join(telDir, '.claude'), 'not a directory');
    const big = makeFile('big.txt', 3000, 100, telDir);
    const { decision, code } = runHook(read(big), { cwd: telDir });
    assert.equal(decision, 'deny');
    assert.equal(code, 0);
  } finally {
    rmSync(telDir, { recursive: true, force: true });
  }
});
