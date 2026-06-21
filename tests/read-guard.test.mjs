// Tests for hooks/read-guard.mjs
// Contract: allow = exit 0 + empty stdout; deny = exit 0 + JSON on stdout.
// Runs the hook as a subprocess (as Claude Code does), feeding JSON on stdin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'read-guard.mjs');

// Run the hook with a payload object, return { stdout, code, decision }.
function runHook(payload) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  let decision = null;
  const out = r.stdout.trim();
  if (out) {
    try { decision = JSON.parse(out).hookSpecificOutput?.permissionDecision; } catch { /* leave null */ }
  }
  return { stdout: out, code: r.status, decision };
}

// Make a temp file with N lines; returns its path. Caller cleans the dir.
function makeFile(dir, name, lines) {
  const p = join(dir, name);
  writeFileSync(p, Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n'));
  return p;
}

const dir = mkdtempSync(join(tmpdir(), 'read-guard-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('non-Read tool passes through', () => {
  const { stdout, code } = runHook({ tool_name: 'Edit', tool_input: { file_path: 'x' } });
  assert.equal(stdout, '');
  assert.equal(code, 0);
});

test('malformed stdin is allowed (fail-open)', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '');
  assert.equal(r.status, 0);
});

test('Read with offset is allowed regardless of size', () => {
  const big = makeFile(dir, 'big-offset.txt', 5000);
  const { decision } = runHook({ tool_name: 'Read', tool_input: { file_path: big, offset: 10 } });
  assert.equal(decision, null);
});

test('Read with limit is allowed regardless of size', () => {
  const big = makeFile(dir, 'big-limit.txt', 5000);
  const { decision } = runHook({ tool_name: 'Read', tool_input: { file_path: big, limit: 50 } });
  assert.equal(decision, null);
});

test('small file blind Read is allowed', () => {
  const small = makeFile(dir, 'small.txt', 100);
  const { decision } = runHook({ tool_name: 'Read', tool_input: { file_path: small } });
  assert.equal(decision, null);
});

test('file exactly at the 600-line limit is allowed', () => {
  const edge = makeFile(dir, 'edge.txt', 600);
  const { decision } = runHook({ tool_name: 'Read', tool_input: { file_path: edge } });
  assert.equal(decision, null);
});

test('file over 600 lines is denied', () => {
  const big = makeFile(dir, 'big.txt', 601);
  const { decision, stdout } = runHook({ tool_name: 'Read', tool_input: { file_path: big } });
  assert.equal(decision, 'deny');
  assert.match(stdout, /601 lines/);
  assert.match(stdout, /offset/);
});

test('file over 256 KB is denied on size before line count', () => {
  const p = join(dir, 'huge.txt');
  writeFileSync(p, 'x'.repeat(300 * 1024)); // 300 KB, single line
  const { decision, stdout } = runHook({ tool_name: 'Read', tool_input: { file_path: p } });
  assert.equal(decision, 'deny');
  assert.match(stdout, /KB/);
});

test('binary extension is allowed even when large', () => {
  const p = join(dir, 'image.png');
  writeFileSync(p, 'x'.repeat(300 * 1024));
  const { decision } = runHook({ tool_name: 'Read', tool_input: { file_path: p } });
  assert.equal(decision, null);
});

test('non-existent file is allowed (nothing to guard)', () => {
  const { decision } = runHook({ tool_name: 'Read', tool_input: { file_path: join(dir, 'nope.txt') } });
  assert.equal(decision, null);
});

test('UTF-8 BOM prefixed payload still parses', () => {
  const small = makeFile(dir, 'bom.txt', 100);
  const r = spawnSync(process.execPath, [HOOK], {
    input: '﻿' + JSON.stringify({ tool_name: 'Read', tool_input: { file_path: small } }),
    encoding: 'utf8',
  });
  assert.equal(r.stdout.trim(), '');
});
