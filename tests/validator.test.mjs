// Guards against plugin directory validator holds (MCP_FORWARDS_CREDENTIAL_ENV): it pairs any
// env read that looks like a credential with any URL it can find as a credential leaving the machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = ['hooks', 'scripts', 'benchmarks'].flatMap((d) =>
  readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.mjs')).map((f) => join(d, f)));

test('shipped code reads no TOKEN-named env var and no dynamic env name', () => {
  for (const f of code) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /process\.env\.\w*TOKEN/i, f);
    assert.doesNotMatch(src, /process\.env\[/, f);
  }
});

test('plugin.json declares no TOKEN-named userConfig key', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  for (const key of Object.keys(manifest.userConfig ?? {})) assert.doesNotMatch(key, /token/i, key);
});
