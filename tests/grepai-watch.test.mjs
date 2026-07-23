// Tests for hooks/grepai-watch.mjs
// Contract: on SessionStart, if cwd is a grepai-initialized repo (.grepai/config.yaml)
// and no watcher runs, launch `grepai watch --background`. Otherwise stay silent.
// These tests cover the no-op branches only — they must not require the grepai binary
// or spawn a real daemon. The launch branch is verified manually against a real repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'grepai-watch.mjs');

// os.tmpdir() is a native path (Windows-style on Windows) so existsSync resolves it.
function run({ input, env } = {}) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: input ?? '',
    env: { ...process.env, ...env },
  });
}

test('GREPAI_WATCH_AUTOSTART=0 opts out with no output', () => {
  const r = run({ env: { GREPAI_WATCH_AUTOSTART: '0' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('cwd without a .grepai marker stays silent (never touches grepai)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-nomark-'));
  const r = run({ input: JSON.stringify({ cwd: dir }) });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('malformed stdin does not crash the session', () => {
  const r = run({ input: '{ not json' });
  assert.equal(r.status, 0); // falls back to process.cwd(), which has no .grepai marker
  assert.equal(r.stdout, '');
});
