// Tests for hooks/inject-policy.mjs
// Contract: prints the policy block to stdout (Claude Code captures it as context).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'inject-policy.mjs');

function run() {
  return spawnSync(process.execPath, [HOOK], { encoding: 'utf8' });
}

test('emits the policy header', () => {
  const r = run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Token Economy policy \(plugin\)/);
});

test('mentions the core rule and the scout subagent', () => {
  const { stdout } = run();
  assert.match(stdout, /Locate, don't read/);
  assert.match(stdout, /scout/);
  assert.match(stdout, /exploring-codebase/);
});
