// Tests for commands/*.md — every command must carry a description frontmatter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CMD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
const files = readdirSync(CMD_DIR).filter((f) => f.endsWith('.md'));

test('there is at least one command', () => {
  assert.ok(files.length > 0);
});

for (const f of files) {
  test(`${f} has a description frontmatter`, () => {
    const body = readFileSync(join(CMD_DIR, f), 'utf8');
    assert.match(body, /^---\r?\n[\s\S]*?\bdescription:\s*\S/m, `${f} missing description`);
  });
}

test('context-audit invokes the scorer', () => {
  const body = readFileSync(join(CMD_DIR, 'context-audit.md'), 'utf8');
  assert.match(body, /score\.mjs/);
  assert.match(body, /CLAUDE_PLUGIN_ROOT/);
});
