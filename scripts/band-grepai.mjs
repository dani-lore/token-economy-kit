// grepai health for band-status: watcher state, and the Ollama diagnosis when it is stopped.
// Pure helpers are exported for tests; the two probes below are the only I/O.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// `grepai watch --status` exits 0 even when stopped, so read stdout.
// "not running" contains "running": test the negative first.
export function parseWatchStatus(stdout) {
  const s = String(stdout ?? '');
  if (/not running/i.test(s)) return false;
  return /running/i.test(s) ? true : null;
}

// provider/endpoint/model under the top-level `embedder:` key, line-based (no YAML lib).
export function parseEmbedder(yaml) {
  const out = {};
  let inside = false;
  for (const line of String(yaml ?? '').split(/\r?\n/)) {
    if (/^\S/.test(line)) { inside = /^embedder\s*:/.test(line); continue; }
    if (!inside) continue;
    const m = line.match(/^\s+(provider|endpoint|model)\s*:\s*["']?([^"'#\s]+)/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// True if `model` is among the /api/tags names; `nomic-embed-text` matches `nomic-embed-text:latest`.
export function modelInTags(tags, model) {
  const names = (tags?.models ?? []).map((m) => String(m?.name ?? m?.model ?? ''));
  return names.some((n) => n === model || (!model.includes(':') && n.split(':')[0] === model));
}

// { running, reason } from the watcher status; `bin` is grepaiBin()'s absolute path, no shell, 3 s timeout.
export function watcherState(root, bin) {
  const r = spawnSync(bin, ['watch', '--status'], { cwd: root, encoding: 'utf8', timeout: 3000 });
  if (r.error) return { running: null, reason: 'status check failed' };
  const running = parseWatchStatus(r.stdout);
  return { running, reason: running === false ? 'daemon stopped' : null };
}

// Reason string for a stopped daemon: Ollama down, model missing, or plain "daemon stopped".
export async function diagnoseStopped(root) {
  try {
    const cfg = parseEmbedder(readFileSync(join(root, '.grepai', 'config.yaml'), 'utf8'));
    if (cfg.provider !== 'ollama' || !cfg.endpoint) return 'daemon stopped';
    let tags;
    try {
      const res = await fetch(`${cfg.endpoint.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return 'Ollama unreachable';
      tags = await res.json();
    } catch { return 'Ollama unreachable'; }
    return cfg.model && !modelInTags(tags, cfg.model) ? `model ${cfg.model} missing` : 'daemon stopped';
  } catch { return 'daemon stopped'; }
}
