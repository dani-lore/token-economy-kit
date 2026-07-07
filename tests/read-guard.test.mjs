// Tests for hooks/read-guard.mjs
// Contract: allow = exit 0 + empty stdout; deny = exit 0 + JSON on stdout.
// Runs the hook as a subprocess (as Claude Code does), feeding JSON on stdin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'read-guard.mjs');

// Run the hook with a payload object, return { stdout, code, decision }.
// cwd = the shared temp dir so deny-time telemetry (logDeny) lands there,
// never in the repo root — keeps the whole suite hermetic.
function runHook(payload) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: dir,
  });
  let decision = null;
  const out = r.stdout.trim();
  if (out) {
    try { decision = JSON.parse(out).hookSpecificOutput?.permissionDecision; } catch { /* leave null */ }
  }
  return { stdout: out, code: r.status, decision };
}

// Same as runHook, but runs the hook subprocess with a given cwd — used to
// assert where the telemetry log lands without touching the repo's own cwd.
function runHookInDir(payload, cwd) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd,
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

// --- shell dump guard (cat/type/Get-Content bypassing the Read guard) ---

test('Bash cat of a large file is denied', () => {
  const big = makeFile(dir, 'cat-big.txt', 601);
  const { decision, stdout } = runHook({ tool_name: 'Bash', tool_input: { command: `cat ${big}` } });
  assert.equal(decision, 'deny');
  assert.match(stdout, /601 lines/);
  assert.match(stdout, /offset/);
});

test('Bash cat of a small file is allowed', () => {
  const small = makeFile(dir, 'cat-small.txt', 100);
  const { decision } = runHook({ tool_name: 'Bash', tool_input: { command: `cat ${small}` } });
  assert.equal(decision, null);
});

test('Bash cat piped into a filter is allowed even when large', () => {
  const big = makeFile(dir, 'cat-pipe.txt', 5000);
  const { decision } = runHook({ tool_name: 'Bash', tool_input: { command: `cat ${big} | grep foo` } });
  assert.equal(decision, null);
});

test('Bash cat redirected to a file is allowed', () => {
  const big = makeFile(dir, 'cat-redir.txt', 5000);
  const { decision } = runHook({ tool_name: 'Bash', tool_input: { command: `cat ${big} > out.txt` } });
  assert.equal(decision, null);
});

test('cat with a cd prefix still guards the file', () => {
  const big = makeFile(dir, 'cat-cd.txt', 5000);
  const { decision } = runHook({ tool_name: 'Bash', tool_input: { command: `cd /tmp && cat ${big}` } });
  assert.equal(decision, 'deny');
});

test('quoted path with spaces is guarded', () => {
  const big = makeFile(dir, 'big file.txt', 5000);
  const { decision } = runHook({ tool_name: 'Bash', tool_input: { command: `cat "${big}"` } });
  assert.equal(decision, 'deny');
});

test('PowerShell Get-Content of a large file is denied', () => {
  const big = makeFile(dir, 'gc-big.txt', 5000);
  const { decision } = runHook({ tool_name: 'PowerShell', tool_input: { command: `Get-Content ${big}` } });
  assert.equal(decision, 'deny');
});

test('PowerShell Get-Content with -TotalCount is allowed', () => {
  const big = makeFile(dir, 'gc-bound.txt', 5000);
  const { decision } = runHook({ tool_name: 'PowerShell', tool_input: { command: `Get-Content ${big} -TotalCount 50` } });
  assert.equal(decision, null);
});

test('shell command that is not a dump is allowed', () => {
  const big = makeFile(dir, 'grep-target.txt', 5000);
  const { decision } = runHook({ tool_name: 'Bash', tool_input: { command: `grep foo ${big}` } });
  assert.equal(decision, null);
});

// --- dense/generated file guard (high avg line length, under both hard limits) ---

test('dense file under both line and byte limits is denied', () => {
  const p = join(dir, 'dense.txt');
  // 200 lines * ~750 chars/line ≈ 150 KB total: under 600 lines AND under 256 KB,
  // but avg bytes/line (~751) is well above the DENSE_AVG threshold (400).
  const content = Array.from({ length: 200 }, (_, i) => `x${i}`.padEnd(750, 'y')).join('\n');
  writeFileSync(p, content);
  const { decision, stdout } = runHook({ tool_name: 'Read', tool_input: { file_path: p } });
  assert.equal(decision, 'deny');
  assert.match(stdout, /dense|generated/);
});

test('550-line file of short lines is allowed (not dense)', () => {
  const p = makeFile(dir, 'short-lines.txt', 550);
  const { decision } = runHook({ tool_name: 'Read', tool_input: { file_path: p } });
  assert.equal(decision, null);
});

// --- realized-savings telemetry (logged at deny time) ---

test('a deny writes a telemetry record to .claude/token-economy/denied.jsonl', () => {
  const telDir = mkdtempSync(join(tmpdir(), 'read-guard-tel-'));
  try {
    const big = makeFile(telDir, 'big.txt', 601);
    const { decision } = runHookInDir({ tool_name: 'Read', tool_input: { file_path: big } }, telDir);
    assert.equal(decision, 'deny');

    const logPath = join(telDir, '.claude', 'token-economy', 'denied.jsonl');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);

    assert.ok('t' in record);
    assert.ok('tool' in record);
    assert.ok('path' in record);
    assert.ok('lines' in record);
    assert.ok('bytes' in record);
    assert.ok('saved' in record);
    assert.equal(record.tool, 'Read');
    assert.equal(record.lines, 601);
    assert.ok(record.saved > 0);
  } finally {
    rmSync(telDir, { recursive: true, force: true });
  }
});

test('deny still happens (fail-open) when the telemetry log dir cannot be created', () => {
  const telDir = mkdtempSync(join(tmpdir(), 'read-guard-tel-blocked-'));
  try {
    // Pre-create a regular FILE at .claude so mkdirSync(.claude/token-economy) throws ENOTDIR.
    writeFileSync(join(telDir, '.claude'), 'not a directory');
    const big = makeFile(telDir, 'big.txt', 601);
    const { decision, code } = runHookInDir({ tool_name: 'Read', tool_input: { file_path: big } }, telDir);
    assert.equal(decision, 'deny');
    assert.equal(code, 0);
  } finally {
    rmSync(telDir, { recursive: true, force: true });
  }
});
