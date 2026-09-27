// Tests for hooks/explore-router.mjs
// Contract: untouched = exit 0 + empty stdout; routed = exit 0 + allow + updatedInput.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'explore-router.mjs');

const dir = mkdtempSync(join(tmpdir(), 'explore-router-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function run(input, option) {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: dir };
  for (const k of Object.keys(env)) if (k.startsWith('CLAUDE_PLUGIN_OPTION_')) delete env[k];
  if (option != null) env.CLAUDE_PLUGIN_OPTION_EXPLORE_MODEL = option;
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    cwd: dir,
    env,
  });
  const out = r.stdout.trim();
  return { code: r.status, out, hso: out ? JSON.parse(out).hookSpecificOutput : null };
}

const explore = (extra = {}) => ({
  tool_name: 'Agent',
  tool_input: { subagent_type: 'Explore', description: 'find it', prompt: 'Where is X defined?', ...extra },
});

test('Explore without model is routed to haiku with the report contract', () => {
  const { code, hso } = run(explore());
  assert.equal(code, 0);
  assert.equal(hso.permissionDecision, 'allow');
  assert.deepEqual(hso.updatedInput, {
    subagent_type: 'Explore',
    description: 'find it',
    model: 'haiku',
    prompt: 'Where is X defined?\n\nReport conclusions with path:line references. Do not paste file contents or list every file you opened.',
  });
});

test('subagent_type match is case-insensitive and Task is covered', () => {
  const { hso } = run({ tool_name: 'Task', tool_input: { subagent_type: 'explore', prompt: 'p' } });
  assert.equal(hso.updatedInput.model, 'haiku');
});

test('explicit model is left untouched', () => {
  assert.equal(run(explore({ model: 'opus' })).out, '');
});

test('other subagent types are left untouched', () => {
  assert.equal(run({ tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose', prompt: 'p' } }).out, '');
});

test('option sonnet is honoured, invalid option falls back to haiku', () => {
  assert.equal(run(explore(), 'sonnet').hso.updatedInput.model, 'sonnet');
  assert.equal(run(explore(), 'gpt-9').hso.updatedInput.model, 'haiku');
});

test('option inherit leaves Explore untouched', () => {
  assert.equal(run(explore(), 'inherit').out, '');
});

test('malformed stdin exits 0 silently', () => {
  const { code, out } = run('not json');
  assert.equal(code, 0);
  assert.equal(out, '');
});

test('UTF-8 BOM prefixed payload still parses', () => {
  assert.equal(run('﻿' + JSON.stringify(explore())).hso.updatedInput.model, 'haiku');
});
