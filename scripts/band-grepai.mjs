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
  // The config comes from the repo: a model name that is not a plain Ollama tag is dropped,
  // since the band shows it inside an `ollama pull` suggestion.
  if (out.model && !/^[A-Za-z0-9._/-]+(:[A-Za-z0-9._-]+)?$/.test(out.model)) delete out.model;
  return out;
}

// /api/tags URL of a loopback Ollama endpoint, else null. The endpoint comes from the repo and the band
// polls on every turn: never send that request off this machine.
export function loopbackTags(endpoint) {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return new URL('/api/tags', url.origin).href;
  } catch { return null; }
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
    const tagsUrl = cfg.provider === 'ollama' && loopbackTags(cfg.endpoint);
    if (!tagsUrl) return 'daemon stopped';
    let tags;
    try {
      const res = await fetch(tagsUrl, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return 'Ollama unreachable';
      tags = await res.json();
    } catch { return 'Ollama unreachable'; }
    return cfg.model && !modelInTags(tags, cfg.model) ? `model ${cfg.model} missing` : 'daemon stopped';
  } catch { return 'daemon stopped'; }
}
