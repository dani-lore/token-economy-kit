// Tests for scripts/band-status.mjs, hermetic: temp --data and --cwd, empty PATH.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseWatchStatus, parseEmbedder, modelInTags } from '../scripts/band-grepai.mjs';

const script = fileURLToPath(new URL('../scripts/band-status.mjs', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'band-'));
// A PATH dir holding an empty grepai binary: found by grepaiBin, never executed without a config.
const BIN = process.platform === 'win32' ? 'grepai.exe' : 'grepai';
function binDir(dir = tmp()) {
  writeFileSync(join(dir, BIN), '');
  return dir;
}
const jsonl = (rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

function run(args, path = '') {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: tmp(), encoding: 'utf8', env: { ...process.env, PATH: path, Path: path },
  });
  assert.equal(r.status, 0);
  return JSON.parse(r.stdout);
}

function fixture() {
  const data = tmp();
  const cwd = tmp();
  writeFileSync(join(data, 'denied.jsonl'), jsonl([
    { t: 1, project: cwd, saved: 1000, session: 's1' },
    { t: 2, project: cwd, saved: 500, session: 's2' },
    'not json {',
    { t: 3, project: join(cwd, 'other'), saved: 9999, session: 's3' },
  ]));
  writeFileSync(join(data, 'reads.jsonl'), jsonl([
    { t: 4, session: 's1', est_tokens: 300 },
    { t: 5, session: 's3', est_tokens: 77 },
    '',
  ]));
  writeFileSync(join(data, 'sessions.jsonl'), jsonl([
    { t: 1, session: 's1', project: cwd, version: '0.1.0', options: { read_budget: 1 } },
    { t: 2, session: 's2', project: cwd, version: '0.2.0', options: { read_budget: 2 } },
  ]));
  return { data, cwd };
}

test('no config: reason "no config", running null, bin from PATH', () => {
  const bin = binDir();
  const o = run(['--cwd', tmp(), '--data', tmp()], bin);
  assert.deepEqual(o.grepai, { config: false, running: null, reason: 'no config', bin: join(bin, BIN) });
  assert.equal(o.plugin.seen, false);
  assert.deepEqual(o.savings.project, { upper: 0, net: 0, denies: 0, followups: 0, usd: null });
});

test('config present, grepai missing: "grepai not installed"', () => {
  const cwd = tmp();
  mkdirSync(join(cwd, '.grepai'));
  writeFileSync(join(cwd, '.grepai', 'config.yaml'), 'embedder:\n  provider: ollama\n');
  const o = run(['--cwd', cwd, '--data', tmp()]);
  assert.deepEqual(o.grepai, { config: true, running: null, reason: 'grepai not installed', bin: null });
});

test('a grepai planted in the project is never used, even when its dir is on PATH', () => {
  const cwd = binDir(tmp());
  const o = run(['--cwd', cwd, '--data', tmp()], cwd);
  assert.deepEqual(o.grepai, { config: false, running: null, reason: 'grepai not installed', bin: null });
});

test('savings: session and project math with follow-up and malformed line', () => {
  const { data, cwd } = fixture();
  const o = run(['--cwd', cwd, '--data', data, '--session', 's1', '--model', 'claude-sonnet-5-5']);
  assert.deepEqual(o.savings.session, { upper: 1000, net: 700, denies: 1, followups: 1, usd: 0.0014 });
  assert.deepEqual(o.savings.project, { upper: 1500, net: 1200, denies: 2, followups: 1, usd: 0.0024 });
});

test('savings: no session gives a zero session object; unknown model gives usd null', () => {
  const { data, cwd } = fixture();
  const o = run(['--cwd', cwd, '--data', data, '--model', 'claude-fable-5']);
  assert.deepEqual(o.savings.session, { upper: 0, net: 0, denies: 0, followups: 0, usd: null });
  assert.equal(o.savings.project.net, 1200);
  assert.equal(o.savings.project.usd, null);
});

test('heartbeat: picked by session, else last of the project', () => {
  const { data, cwd } = fixture();
  const a = run(['--cwd', cwd, '--data', data, '--session', 's1']);
  assert.deepEqual(a.plugin, { seen: true, version: '0.1.0', options: { read_budget: 1 } });
  assert.equal(run(['--cwd', cwd, '--data', data]).plugin.version, '0.2.0');
  assert.equal(run(['--cwd', cwd, '--data', data, '--session', 'nope']).plugin.seen, false);
});

test('parseWatchStatus', () => {
  assert.equal(parseWatchStatus('Status: not running'), false);
  assert.equal(parseWatchStatus('Status: Running (pid 12)'), true);
  assert.equal(parseWatchStatus('???'), null);
  assert.equal(parseWatchStatus(undefined), null);
});

test('parseEmbedder reads the embedder section only', () => {
  const y = 'store:\n  model: nope\nembedder:\n  provider: ollama\n  model: nomic-embed-text\n  endpoint: http://localhost:11434\nother:\n  model: x\n';
  assert.deepEqual(parseEmbedder(y), { provider: 'ollama', model: 'nomic-embed-text', endpoint: 'http://localhost:11434' });
});

test('modelInTags matches the name with or without tag', () => {
  const tags = { models: [{ name: 'nomic-embed-text:latest' }] };
  assert.equal(modelInTags(tags, 'nomic-embed-text'), true);
  assert.equal(modelInTags(tags, 'nomic-embed-text:latest'), true);
  assert.equal(modelInTags(tags, 'bge-m3'), false);
  assert.equal(modelInTags({}, 'x'), false);
});
