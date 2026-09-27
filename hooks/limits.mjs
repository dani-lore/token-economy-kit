// Single source of the thresholds shared by read-guard, session-start and the benchmark.
// Token estimate: ≈4 bytes per token, no tokenizer (deterministic, zero deps).

import { homedir } from 'node:os';
import { join } from 'node:path';

// Positive number from an env value, else the default (unset, non-numeric, ≤ 0).
// The plugin directory validator reads any env var named like *TOKEN* as a credential, and any
// env lookup by computed name too: env names stay literal and never contain TOKEN.
function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Whole-file reads estimated above this many tokens are denied (userConfig `read_budget`).
export const READ_BUDGET = positive(process.env.CLAUDE_PLUGIN_OPTION_READ_BUDGET, 10000);
// A Read with `limit` up to this many lines always passes.
export const SLICE_MAX_LINES = 600;
// What the native Read returns without offset/limit: first 2000 lines, capped in tokens.
export const NATIVE_READ_LINES = 2000;
// ponytail: Claude Code's default cap, not read from its env override (see note above); a raised
// override only makes the cost model conservative.
export const NATIVE_READ_CAP = 25000;

// Extensions the guard never judges: binaries/media, handled natively by Read.
export const SKIP_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.bmp',
  '.pdf','.ipynb','.zip','.gz','.7z','.exe','.dll','.node',
  '.wasm','.woff','.woff2','.ttf','.eot','.mp3','.mp4','.mov',
  '.avi','.db','.sqlite','.sqlite3',
]);

export const tokens = (bytes) => Math.ceil(bytes / 4);

// Tokens the native Read would return for the first `lines` lines of `text`.
function readCost(text, lines) {
  let end = -1;
  for (let i = 0; i < lines; i++) {
    end = text.indexOf('\n', end + 1);
    if (end === -1) { end = text.length; break; }
  }
  return Math.min(tokens(Buffer.byteLength(text.slice(0, end), 'utf8')), NATIVE_READ_CAP);
}

// Cost of a Read without offset/limit.
export const blindReadCost = (text) => readCost(text, NATIVE_READ_LINES);
// Cost of the largest slice the guard lets through.
export const sliceCost = (text) => readCost(text, SLICE_MAX_LINES);

// Where deny telemetry goes: the plugin's data dir, never the user's repo.
export const logDir = () => process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'token-economy');
