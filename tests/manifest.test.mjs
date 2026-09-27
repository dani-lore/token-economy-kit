// Tests for the plugin manifests: hooks.json points at real files,
// plugin.json carries a semver version and a license.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

test('every path referenced in hooks.json exists', () => {
  const { hooks } = readJson('hooks/hooks.json');
  const commands = Object.values(hooks).flat().flatMap((group) => group.hooks.map((h) => h.command));
  assert.ok(commands.length > 0);
  for (const command of commands) {
    const paths = [...command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)].map((m) => m[1]);
    assert.ok(paths.length > 0, `no plugin path in: ${command}`);
    for (const p of paths) assert.ok(existsSync(join(ROOT, p)), `missing: ${p}`);
  }
});

test('plugin.json has a semver version and a license', () => {
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.match(plugin.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(typeof plugin.license, 'string');
  assert.ok(existsSync(join(ROOT, 'LICENSE')));
});
