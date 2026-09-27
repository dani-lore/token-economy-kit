// PreToolUse hook (matcher: Read): blocks whole-file reads whose estimated
// token cost exceeds READ_MAX_TOKENS. A Read with limit ≤ SLICE_MAX_LINES passes.
// Contract: allow = exit 0 + no stdout; deny = exit 0 + JSON on stdout.

import { openSync, readSync, closeSync, statSync, appendFileSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  READ_MAX_TOKENS, SLICE_MAX_LINES, SKIP_EXTS, tokens, blindReadCost, sliceCost,
} from './limits.mjs';

// Content is read only as a prefix of this size (line count, `saved`).
const PREFIX_BYTES = 2 * 1024 * 1024;

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }) + '\n');
}

// Best-effort append to the realized-savings log. Never throws: a telemetry
// failure must never block or break a deny (fail-open is sacred here).
function logDeny(record) {
  try {
    const dir = join(process.cwd(), '.claude', 'token-economy');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'denied.jsonl'), JSON.stringify(record) + '\n');
  } catch {
    // no-op: logging is not allowed to affect the deny decision
  }
}

function readPrefix(filePath, size) {
  const buf = Buffer.alloc(Math.min(size, PREFIX_BYTES));
  const fd = openSync(filePath, 'r');
  try {
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

// A deny descriptor { reason, lines, bytes, saved } if a whole-file read of
// this path is over budget, else null. Missing file or directory → null.
function overBudget(filePath) {
  if (!filePath || SKIP_EXTS.has(extname(filePath).toLowerCase())) return null;
  let stat;
  try { stat = statSync(filePath); } catch { return null; }
  if (!stat.isFile()) return null;
  const bytes = stat.size;
  const est = tokens(bytes);
  if (est <= READ_MAX_TOKENS) return null;

  const text = readPrefix(filePath, bytes);
  const complete = bytes <= PREFIX_BYTES;
  const lines = complete
    ? (text.match(/\n/g) ?? []).length + (text.endsWith('\n') ? 0 : 1)
    : null;
  const size = lines == null ? '' : ` (${lines} lines)`;
  const reason =
    `Read blocked: "${filePath}" is ~${est} tokens${size}; whole-file reads are capped at ` +
    `${READ_MAX_TOKENS} tokens. Read the part you need with offset/limit ` +
    `(limit ≤ ${SLICE_MAX_LINES}), located via the outline below or Grep.`;
  // `saved` is a ceiling: what the blind read would have cost, minus the
  // largest slice we still allow and the deny message itself.
  const saved = Math.max(0, blindReadCost(text) - sliceCost(text) - tokens(Buffer.byteLength(reason)));
  return { reason, lines, bytes, saved };
}

// Read all stdin via event-based approach (works on Windows PowerShell pipes)
function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
    // If stdin is already closed/empty (TTY), resolve immediately after tick
    if (process.stdin.readableEnded) resolve('');
  });
}

try {
  const raw = await readStdin();

  // Strip UTF-8 BOM if present (PowerShell Out-File adds it)
  const stripped = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;

  let payload;
  try { payload = JSON.parse(stripped); } catch { process.exit(0); }

  if (payload?.tool_name !== 'Read') process.exit(0);
  const input = payload.tool_input ?? {};
  if (input.limit != null && Number(input.limit) <= SLICE_MAX_LINES) process.exit(0);

  const over = overBudget(input.file_path);
  if (over) {
    logDeny({ t: Date.now(), tool: 'Read', path: input.file_path, lines: over.lines, bytes: over.bytes, saved: over.saved });
    deny(over.reason);
  }
  process.exit(0);
} catch {
  // Any internal error → allow silently
  process.exit(0);
}
