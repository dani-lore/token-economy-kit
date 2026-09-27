// Tests for commands/*.md: frontmatter, permissions for injected `!` shell
// commands (outside auto mode a non-allowed one aborts the command), and the
// plugin files those commands run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CMD_DIR = join(ROOT, 'commands');
const files = readdirSync(CMD_DIR).filter((f) => f.endsWith('.md'));

const frontmatter = (body) => body.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';

test('there is at least one command', () => {
  assert.ok(files.length > 0);
});

for (const f of files) {
  const body = readFileSync(join(CMD_DIR, f), 'utf8');
  const fm = frontmatter(body);

  test(`${f} has a description and is user-only`, () => {
    assert.match(fm, /^description:\s*\S/m);
    assert.match(fm, /^disable-model-invocation:\s*true\s*$/m);
  });

  const injected = [...body.matchAll(/!`([^`]+)`/g)].map((m) => m[1]);
  if (!injected.length) continue;

  test(`${f} allows exactly the plugin scripts it injects`, () => {
    // Narrow grants only: the directory validator holds a broad Bash(node *).
    const rules = [...fm.matchAll(/Bash\(([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(rules.length, 'no Bash(...) rule in allowed-tools');
    for (const rule of rules) assert.match(rule, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\//, rule);
    for (const cmd of injected) {
      const ok = rules.some((r) => (r.endsWith(' *') ? cmd.startsWith(r.slice(0, -1)) : cmd === r));
      assert.ok(ok, `not covered by allowed-tools: ${cmd}`);
    }
  });

  test(`${f} runs plugin files that exist`, () => {
    for (const cmd of injected) {
      const paths = [...cmd.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/g)].map((m) => m[1]);
      for (const p of paths) assert.ok(existsSync(join(ROOT, p)), `missing: ${p}`);
    }
  });
}

test('context-audit scores the cwd, economy-stats reads the plugin data dir', () => {
  const audit = readFileSync(join(CMD_DIR, 'context-audit.md'), 'utf8');
  assert.match(audit, /!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/benchmarks\/score\.mjs"`/);
  const stats = readFileSync(join(CMD_DIR, 'economy-stats.md'), 'utf8');
  assert.match(stats, /scripts\/economy-stats\.mjs" "\$\{CLAUDE_PLUGIN_DATA\}"`/);
});
