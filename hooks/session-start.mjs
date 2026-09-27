// SessionStart hook: injects the exploration policy as additionalContext and,
// in grepai projects, starts `grepai watch` in the background.
// Output: one JSON object, or nothing when there is nothing to say.
// Any internal error → exit 0 silently: session start must never break.

import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { READ_BUDGET, SLICE_MAX_LINES } from './limits.mjs';
import { readPayload } from './stdin.mjs';

// A toggle is off when any of the given env values is 0/false.
// Callers pass env values, not names: the directory validator holds dynamic env reads.
function enabled(...values) {
  return !values.some((v) => v != null && /^(0|false)$/i.test(v.trim()));
}

// Nearest directory at or above `cwd` initialized by `grepai init`, else null.
function grepaiRoot(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.grepai', 'config.yaml'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

function policy(hasGrepai) {
  const k = Math.round(READ_BUDGET / 100) / 10;
  const search = hasGrepai
    ? 'Locate with grepai_search first (compact: true for locations only), then Grep/Glob for exact strings.'
    : 'Locate with Grep/Glob instead of exploratory Reads.';
  return [
    '=== Token economy (plugin) ===',
    'Every tool result stays in context for the rest of the session, so fetch less.',
    search,
    `Read to act, in slices: offset/limit (limit ≤ ${SLICE_MAX_LINES}); whole-file reads over ~${k}k tokens are blocked by a hook.`,
    'Wide questions that need many files read: delegate to the Explore subagent and ask for path:line conclusions; small lookups are cheaper done directly.',
    'Long command output: filter at the source (grep, head, quiet flags).',
    'Full protocol: skill exploring-codebase.',
  ].join('\n');
}

// Start `grepai watch --background` in `root` unless it already runs.
// Returns true if a start was launched. No shell: grepai(.exe) via PATH.
function startWatcher(root) {
  const status = spawnSync('grepai', ['watch', '--status'], { cwd: root, encoding: 'utf8', timeout: 3000 });
  if (status.error) return false; // not on PATH, or --status hung
  // "not running" contains "running", so match the negative explicitly.
  if (status.status === 0 && !/not running/i.test(status.stdout || '')) return false;
  spawn('grepai', ['watch', '--background'], { cwd: root, detached: true, stdio: 'ignore' })
    .on('error', () => {})
    .unref();
  return true;
}

try {
  const payload = await readPayload();
  const root = grepaiRoot(payload?.cwd || process.cwd());
  const out = {};

  if (enabled(process.env.CLAUDE_PLUGIN_OPTION_INJECT_POLICY)) {
    out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: policy(root != null) };
  }
  const watchable = ['startup', 'resume'].includes(payload?.source);
  if (root && watchable && enabled(process.env.CLAUDE_PLUGIN_OPTION_GREPAI_AUTOSTART, process.env.GREPAI_WATCH_AUTOSTART)
      && startWatcher(root)) {
    out.systemMessage = `grepai watch started in the background for ${root} (stop with: grepai watch --stop)`;
  }
  if (Object.keys(out).length) process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
} catch {
  process.exit(0);
}
