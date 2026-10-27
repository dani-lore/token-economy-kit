// Savings and heartbeat lookups for band-status, from the telemetry JSONL files.

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { logDir, inputPrice, DENIED_LOG, READS_LOG, SESSIONS_LOG } from '../hooks/limits.mjs';

// Symlinks resolved when the path exists; Windows paths compare case-insensitively.
export function norm(p) {
  let r = resolve(String(p));
  try { r = realpathSync(r); } catch { /* gone: compare as given */ }
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

// Data dirs: only `--data` when given, else every token-economy-* plugin data dir plus logDir().
export function dataDirs(data) {
  if (data) return [data];
  const base = join(homedir(), '.claude', 'plugins', 'data');
  let found = [];
  try {
    found = readdirSync(base).filter((n) => n.startsWith('token-economy-')).map((n) => join(base, n));
  } catch { /* no plugin data yet */ }
  const seen = new Set();
  return [...found, logDir()].filter((d) => !seen.has(norm(d)) && seen.add(norm(d)));
}

export function readRows(dirs, name) {
  const rows = [];
  for (const dir of dirs) {
    let text;
    try { text = readFileSync(join(dir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      try {
        const r = JSON.parse(line);
        if (r && typeof r === 'object') rows.push(r);
      } catch { /* skip blank or malformed */ }
    }
  }
  return rows;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function totals(denied, follow, price) {
  const upper = denied.reduce((a, r) => a + num(r.saved), 0);
  const net = Math.max(0, upper - follow.reduce((a, r) => a + num(r.est_tokens), 0));
  const usd = price == null ? null : Math.round(((net * price) / 1e6) * 1e4) / 1e4;
  return { upper, net, denies: denied.length, followups: follow.length, usd };
}

// { session, project } totals. Reads rows carry no project: a follow-up belongs to a project
// when its session id appears in one of that project's denied rows.
export function savings(dirs, { cwd, session, model }) {
  const denied = readRows(dirs, DENIED_LOG);
  const reads = readRows(dirs, READS_LOG);
  const price = inputPrice(model);
  const here = denied.filter((r) => r.project && norm(r.project) === norm(cwd));
  const hereSessions = new Set(here.map((r) => r.session).filter(Boolean));
  return {
    session: totals(
      session ? denied.filter((r) => r.session === session) : [],
      session ? reads.filter((r) => r.session === session) : [],
      price,
    ),
    project: totals(here, reads.filter((r) => hereSessions.has(r.session)), price),
  };
}

// Last heartbeat of `session`, else of the project; null if none.
export function heartbeat(dirs, { cwd, session }) {
  const rows = readRows(dirs, SESSIONS_LOG).sort((a, b) => num(a.t) - num(b.t));
  const match = session
    ? (r) => r.session === session
    : (r) => r.project && norm(r.project) === norm(cwd);
  return rows.filter(match).pop() ?? null;
}
