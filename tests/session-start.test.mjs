// Tests for hooks/session-start.mjs
// Contract: one JSON object on stdout (policy in additionalContext, systemMessage
// only when a watcher was started), or nothing; always exit 0.
// Every run gets an empty PATH, so grepai is never found and no daemon starts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'session-start.mjs');

const dir = mkdtempSync(join(tmpdir(), 'session-start-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const plain = join(dir, 'plain');
const indexed = join(dir, 'indexed');
const nested = join(indexed, 'src', 'deep');
mkdirSync(plain);
mkdirSync(join(indexed, '.grepai'), { recursive: true });
writeFileSync(join(indexed, '.grepai', 'config.yaml'), 'version: 1\n');
mkdirSync(nested, { recursive: true });

// Env: temp plugin data, no options or legacy toggles from the shell, no PATH.
function hookEnv(extra) {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: join(dir, 'plugin-data') };
  for (const k of Object.keys(env)) {
    if (/^(CLAUDE_PLUGIN_OPTION_|GREPAI_WATCH_AUTOSTART$|PATH$)/i.test(k)) delete env[k];
  }
  return { ...env, PATH: '', ...extra };
}

function run(input, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd: plain,
    env: hookEnv(env),
  });
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trim();
  return out ? JSON.parse(out) : null;
}

const context = (out) => out.hookSpecificOutput.additionalContext;

test('injects the policy with Grep/Glob search outside grepai projects', () => {
  const out = run({ source: 'startup', cwd: plain });
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const text = context(out);
  assert.match(text, /^=== Token economy \(plugin\) ===\n/);
  assert.match(text, /Every tool result stays in context for the rest of the session, so fetch less\./);
  assert.match(text, /Locate with Grep\/Glob instead of exploratory Reads\./);
  assert.match(text, /limit ≤ 600\); whole-file reads over ~10k tokens are blocked by a hook\./);
  assert.match(text, /delegate to the Explore subagent/);
  assert.match(text, /filter at the source/);
  assert.match(text, /Full protocol: skill exploring-codebase\./);
  assert.doesNotMatch(text, /grepai/);
  assert.equal(out.systemMessage, undefined);
});

test('a .grepai marker above the cwd switches the search line to grepai', () => {
  const text = context(run({ source: 'startup', cwd: nested }));
  assert.match(text, /grepai_search first \(compact: true for locations only\), then Grep\/Glob/);
});

test('without grepai on PATH no watcher starts and no systemMessage is sent', () => {
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    assert.equal(run({ source, cwd: indexed }).systemMessage, undefined);
  }
});

test('the read budget in the policy follows the option', () => {
  const out = run({ source: 'startup', cwd: plain }, { CLAUDE_PLUGIN_OPTION_READ_BUDGET: '25000' });
  assert.match(context(out), /over ~25k tokens/);
});

test('policy injection turns off via the option', () => {
  for (const env of [
    { CLAUDE_PLUGIN_OPTION_INJECT_POLICY: 'false' },
    { CLAUDE_PLUGIN_OPTION_INJECT_POLICY: '0' },
  ]) {
    assert.equal(run({ source: 'startup', cwd: indexed }, env), null, JSON.stringify(env));
  }
  assert.ok(run({ source: 'startup', cwd: plain }, { CLAUDE_PLUGIN_OPTION_INJECT_POLICY: 'true' }));
});

test('autostart off leaves the policy untouched', () => {
  for (const env of [{ CLAUDE_PLUGIN_OPTION_GREPAI_AUTOSTART: 'false' }, { GREPAI_WATCH_AUTOSTART: '0' }]) {
    const out = run({ source: 'startup', cwd: indexed }, env);
    assert.match(context(out), /grepai_search first/);
    assert.equal(out.systemMessage, undefined);
  }
});

test('malformed stdin falls back to the process cwd', () => {
  assert.match(context(run('{ not json')), /Locate with Grep\/Glob/);
});

test('UTF-8 BOM prefixed payload still parses', () => {
  const text = context(run('﻿' + JSON.stringify({ source: 'startup', cwd: indexed })));
  assert.match(text, /grepai_search first/);
});

// --- watcher start, against a fake grepai (POSIX only: a shell script on PATH) ---

const posixOnly = { skip: process.platform === 'win32' && 'fake grepai is a shell script' };

function fakeGrepai(name, status) {
  const bin = join(dir, name);
  mkdirSync(bin);
  const script = join(bin, 'grepai');
  writeFileSync(script, '#!/bin/sh\necho "$*" >> "$FAKE_GREPAI_LOG"\n[ "$2" = "--status" ] && echo "$FAKE_GREPAI_STATUS"\nexit 0\n');
  chmodSync(script, 0o755);
  const log = join(bin, 'calls.log');
  return { log, env: { PATH: bin, FAKE_GREPAI_LOG: log, FAKE_GREPAI_STATUS: status } };
}

// The --background launch is fire-and-forget: wait briefly for its log line.
function waitForLine(log, line, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(log) && readFileSync(log, 'utf8').split('\n').includes(line)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return false;
}

test('a stopped watcher is started on startup, with a systemMessage', posixOnly, () => {
  const { log, env } = fakeGrepai('bin-stopped', 'watcher not running');
  const out = run({ source: 'startup', cwd: nested }, env);
  assert.equal(out.systemMessage,
    `grepai watch started in the background for ${indexed} (stop with: grepai watch --stop)`);
  assert.ok(waitForLine(log, 'watch --background'));
});

test('a running watcher is left alone, and clear/compact never touch grepai', posixOnly, () => {
  const running = fakeGrepai('bin-running', 'watcher running');
  assert.equal(run({ source: 'resume', cwd: indexed }, running.env).systemMessage, undefined);
  assert.deepEqual(readFileSync(running.log, 'utf8').trim().split('\n'), ['watch --status']);

  const idle = fakeGrepai('bin-idle', 'watcher not running');
  for (const source of ['clear', 'compact']) {
    assert.equal(run({ source, cwd: indexed }, idle.env).systemMessage, undefined);
  }
  assert.equal(existsSync(idle.log), false);
});
