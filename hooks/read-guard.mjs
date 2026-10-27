// PreToolUse hook (matcher: Read): blocks whole-file reads whose estimated
// token cost exceeds READ_BUDGET. A Read with limit ≤ SLICE_MAX_LINES passes.
// Contract: allow = exit 0 + no stdout; deny = exit 0 + JSON on stdout.

import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import {
  READ_BUDGET, SLICE_MAX_LINES, NATIVE_READ_LINES, NATIVE_READ_CAP, SKIP_EXTS, DENIED_LOG, READS_LOG,
  tokens, blindReadCost, sliceCost,
} from './limits.mjs';
import { appendLog, rememberDeny, recallDeny } from './telemetry.mjs';
import { readPayload } from './stdin.mjs';

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

// A Read that passes for a path denied earlier in this session is the follow-up the deny asked for:
// log what it will return. Sizes come from the deny record, the file is never read here.
// Never throws, never changes the decision.
function logFollowUp(payload, input) {
  try {
    const session = payload.session_id;
    const prior = recallDeny(session, input.file_path);
    if (!prior || !prior.lines || !prior.bytes) return; // unknown size (file over the prefix): no estimate
    const asked = input.limit != null && Number(input.limit) > 0 ? Number(input.limit) : NATIVE_READ_LINES;
    const lines = Math.min(asked, prior.lines);
    const est = Math.min(tokens(Math.round(lines * prior.bytes / prior.lines)), NATIVE_READ_CAP);
    appendLog(READS_LOG, { t: Date.now(), session, path: input.file_path, lines, est_tokens: est });
  } catch {
    // no-op: logging is not allowed to affect the allow decision
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

const MD_EXTS = new Set(['.md', '.mdx', '.markdown']);
const MD_HEADING = /^#{1,3}\s/;
const DECLARATION = new RegExp(
  '^(?:(?:export|default|pub|public|async)\\s+)*' +
  '(?:class|def|function|func|fn|fun|interface|type|struct|enum|impl|trait|module|namespace|const|describe|test)\\b',
);
const OUTLINE_MAX = 30;

// Map of the file to aim a slice at: `L<n> <line>` per heading/declaration.
// ponytail: column-0 regex scan, no parser — misses indented or nested
// declarations and treats `#` lines inside code fences as headings.
function outline(filePath, text, complete) {
  const re = MD_EXTS.has(extname(filePath).toLowerCase()) ? MD_HEADING : DECLARATION;
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (re.test(line)) hits.push(`L${i + 1} ${line.replace(/\r$/, '').slice(0, 80)}`);
  });
  if (!hits.length) return '';
  const more = hits.length > OUTLINE_MAX ? [`… ${hits.length - OUTLINE_MAX} more`] : [];
  const head = complete ? 'Outline:' : `Outline (first ${PREFIX_BYTES / 1024 / 1024} MB only):`;
  return ['', head, ...hits.slice(0, OUTLINE_MAX), ...more].join('\n');
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
  if (est <= READ_BUDGET) return null;

  const text = readPrefix(filePath, bytes);
  const complete = bytes <= PREFIX_BYTES;
  const lines = complete
    ? (text.match(/\n/g) ?? []).length + (text.endsWith('\n') ? 0 : 1)
    : null;
  const size = lines == null ? '' : ` (${lines} lines)`;
  const reason =
    `Read blocked: "${filePath}" is ~${est} tokens${size}; whole-file reads are capped at ` +
    `${READ_BUDGET} tokens. Read the part you need with offset/limit ` +
    `(limit ≤ ${SLICE_MAX_LINES}), located via the outline below or Grep.` +
    outline(filePath, text, complete);
  // `saved` is a ceiling: what the blind read would have cost, minus the
  // largest slice we still allow and the deny message itself.
  const saved = Math.max(0, blindReadCost(text) - sliceCost(text) - tokens(Buffer.byteLength(reason)));
  return { reason, lines, bytes, saved };
}

try {
  const payload = await readPayload();
  if (payload?.tool_name !== 'Read') process.exit(0);
  const input = payload.tool_input ?? {};
  if (input.limit != null && Number(input.limit) <= SLICE_MAX_LINES) {
    logFollowUp(payload, input);
    process.exit(0);
  }

  const over = overBudget(input.file_path);
  if (over) {
    const project = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
    const session = payload.session_id ?? null;
    appendLog(DENIED_LOG, {
      t: Date.now(), project, path: input.file_path, lines: over.lines, bytes: over.bytes, saved: over.saved, session,
    });
    rememberDeny(session, input.file_path, { bytes: over.bytes, lines: over.lines });
    deny(over.reason);
  } else {
    logFollowUp(payload, input);
  }
  process.exit(0);
} catch {
  // Any internal error → allow silently
  process.exit(0);
}
