// SessionStart hook: auto-start grepai's file watcher in the current repo.
// Fixes the "I forgot to run grepai watch, so the MCP serves a stale index" trap.
// Scope is the session's cwd only (not a disk-wide scan): watch starts exactly
// when you open Claude in an initialized repo, which is when you'd forget.
// grepai owns the daemon lifecycle (--background/--status/--stop); we just poke it.
// Opt out with GREPAI_WATCH_AUTOSTART=0.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

if (process.env.GREPAI_WATCH_AUTOSTART === '0') process.exit(0);

// Never break the session: any failure here is silent.
try {
  // cwd comes from the SessionStart hook payload; fall back to process.cwd().
  let cwd = process.cwd();
  try {
    const raw = readFileSync(0, 'utf8');
    if (raw) cwd = JSON.parse(raw).cwd || cwd;
  } catch {}

  // Init marker: `grepai init` creates .grepai/config.yaml.
  if (!existsSync(join(cwd, '.grepai', 'config.yaml'))) process.exit(0);

  // No shell: Node resolves grepai/grepai.exe via PATH(EXT), avoiding the DEP0190 shell warning.
  const status = spawnSync('grepai', ['watch', '--status'], {
    cwd, encoding: 'utf8', timeout: 10000,
  });
  if (status.error) process.exit(0); // grepai not on PATH → nothing to do.

  // Already watching this worktree? Leave it. ("not running" contains "running", so match explicitly.)
  if (status.status === 0 && !/not running/i.test(status.stdout || '')) process.exit(0);

  // Fire-and-forget: grepai --background detaches its own daemon; don't hold the session.
  spawn('grepai', ['watch', '--background'], {
    cwd, detached: true, stdio: 'ignore',
  }).unref();

  process.stdout.write('grepai watch avviato in background per questa repo.\n');
} catch {
  // ponytail: silent by design — a watcher hiccup must not block session start.
}
