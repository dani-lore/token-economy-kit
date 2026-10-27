// Best-effort telemetry in logDir(), shared by read-guard and session-start.
// Every function swallows its own errors: telemetry must never change a hook's decision or output.

import {
  appendFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { logDir, SESSIONS_DIR, SESSION_MAP_MAX_AGE_MS, sessionMapName } from './limits.mjs';

export function appendLog(name, record) {
  try {
    const dir = logDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, name), JSON.stringify(record) + '\n');
  } catch { /* no-op */ }
}

const mapPath = (session) => join(logDir(), SESSIONS_DIR, sessionMapName(session));

function loadMap(session) {
  try {
    const map = JSON.parse(readFileSync(mapPath(session), 'utf8'));
    return map && typeof map === 'object' ? map : {};
  } catch { return {}; }
}

// Remember that `path` was denied in `session`, with the size facts a follow-up read needs.
// Read-modify-write without a lock: two denies in the same instant may drop one entry (a missed follow-up).
export function rememberDeny(session, path, entry) {
  if (!session) return;
  try {
    const map = loadMap(session);
    map[path] = entry;
    mkdirSync(join(logDir(), SESSIONS_DIR), { recursive: true });
    writeFileSync(mapPath(session), JSON.stringify(map));
  } catch { /* no-op */ }
}

// { bytes, lines } if `path` was denied earlier in `session`, else null.
export function recallDeny(session, path) {
  if (!session) return null;
  const entry = loadMap(session)[path];
  return entry && typeof entry === 'object' ? entry : null;
}

// Delete session maps untouched for SESSION_MAP_MAX_AGE_MS.
export function pruneSessionMaps(now = Date.now()) {
  try {
    const dir = join(logDir(), SESSIONS_DIR);
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      try { if (now - statSync(file).mtimeMs > SESSION_MAP_MAX_AGE_MS) unlinkSync(file); } catch { /* next */ }
    }
  } catch { /* no dir yet */ }
}
