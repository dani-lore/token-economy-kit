// SessionStart hook: injects the exploration policy as additionalContext and,
// in grepai projects, starts `grepai watch` in the background.
// Output: one JSON object, or nothing when there is nothing to say.
// Any internal error → exit 0 silently: session start must never break.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { READ_BUDGET, SLICE_MAX_LINES, SESSIONS_LOG, exploreModel } from './limits.mjs';
import { appendLog, pruneSessionMaps } from './telemetry.mjs';
import { readPayload } from './stdin.mjs';
import { grepaiRoot, grepaiBin } from './grepai-root.mjs';

// A toggle is off when any of the given env values is 0/false.
// Callers pass env values, not names: the directory validator holds dynamic env reads.
function enabled(...values) {
  return !values.some((v) => v != null && /^(0|false)$/i.test(v.trim()));
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
// Returns true if a start was launched. No shell: grepai resolved from PATH, never from the repo.
function startWatcher(root) {
  const bin = grepaiBin(root);
  if (!bin) return false;
  const status = spawnSync(bin, ['watch', '--status'], { cwd: root, encoding: 'utf8', timeout: 3000 });
  if (status.error) return false; // --status failed or hung
  // "not running" contains "running", so match the negative explicitly.
  if (status.status === 0 && !/not running/i.test(status.stdout || '')) return false;
  spawn(bin, ['watch', '--background'], { cwd: root, detached: true, stdio: 'ignore' })
    .on('error', () => {})
    .unref();
  return true;
}

// Plugin version from the manifest, null if unreadable. The hook's own location is the fallback root.
function pluginVersion() {
  try {
    const root = process.env.CLAUDE_PLUGIN_ROOT || fileURLToPath(new URL('..', import.meta.url));
    return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version ?? null;
  } catch { return null; }
}

// Heartbeat: one line per session start with the effective options, plus housekeeping of old
// session maps. Best effort and synchronous but tiny: never changes the hook's output.
function logSession(payload, inject, autostart) {
  appendLog(SESSIONS_LOG, {
    t: Date.now(),
    session: payload?.session_id ?? null,
    project: process.env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd(),
    version: pluginVersion(),
    options: { read_budget: READ_BUDGET, explore_model: exploreModel(), inject_policy: inject, grepai_autostart: autostart },
  });
  pruneSessionMaps();
}

try {
  const payload = await readPayload();
  const root = grepaiRoot(payload?.cwd || process.cwd());
  const out = {};

  const inject = enabled(process.env.CLAUDE_PLUGIN_OPTION_INJECT_POLICY);
  const autostart = enabled(process.env.CLAUDE_PLUGIN_OPTION_GREPAI_AUTOSTART, process.env.GREPAI_WATCH_AUTOSTART);
  logSession(payload, inject, autostart);

  if (inject) {
    out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: policy(root != null) };
  }
  const watchable = ['startup', 'resume'].includes(payload?.source);
  if (root && watchable && autostart && startWatcher(root)) {
    out.systemMessage = `grepai watch started in the background for ${root} (stop with: grepai watch --stop)`;
  }
  if (Object.keys(out).length) process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
} catch {
  process.exit(0);
}
