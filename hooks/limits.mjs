// Single source of the thresholds shared by read-guard, session-start and the benchmark.
// Token estimate: ≈4 bytes per token, no tokenizer (deterministic, zero deps).

import { homedir } from 'node:os';
import { join } from 'node:path';

// Positive number from an env var, else the default (unset, non-numeric, ≤ 0).
function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Whole-file reads estimated above this many tokens are denied.
export const READ_MAX_TOKENS = envNumber('CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS', 10000);
// A Read with `limit` up to this many lines always passes.
export const SLICE_MAX_LINES = 600;
// What the native Read returns without offset/limit: first 2000 lines, capped in tokens.
export const NATIVE_READ_LINES = 2000;
export const NATIVE_READ_TOKENS = envNumber('CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS', 25000);

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
  return Math.min(tokens(Buffer.byteLength(text.slice(0, end), 'utf8')), NATIVE_READ_TOKENS);
}

// Cost of a Read without offset/limit.
export const blindReadCost = (text) => readCost(text, NATIVE_READ_LINES);
// Cost of the largest slice the guard lets through.
export const sliceCost = (text) => readCost(text, SLICE_MAX_LINES);

// Where deny telemetry goes: the plugin's data dir, never the user's repo.
export const logDir = () => process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.claude', 'token-economy');
