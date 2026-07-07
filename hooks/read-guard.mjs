// PreToolUse hook: blocks blind full-file reads on large text files.
// Covers the Read tool AND whole-file shell dumps (cat/type/Get-Content/gc),
// which would otherwise bypass the guard by piping a file into context.
// Contract: allow = exit 0 + no stdout; deny = exit 0 + JSON on stdout.

import { readFileSync, statSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

const BINARY_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.bmp',
  '.pdf','.ipynb','.zip','.gz','.7z','.exe','.dll','.node',
  '.wasm','.woff','.woff2','.ttf','.eot','.mp3','.mp4','.mov',
  '.avi','.db','.sqlite','.sqlite3','.lock',
]);

const MAX_BYTES = 262144; // 256 KB
const MAX_LINES = 600;

// Commands that print an entire file to stdout (→ into context). head/tail are
// self-limiting (default 10 lines) so they are NOT guarded; only whole-file dumps.
const DUMP_CMDS = new Set(['cat', 'type', 'get-content', 'gc']);
// PowerShell flags that bound Get-Content output → treat as a targeted read, allow.
const BOUND_FLAGS = ['-totalcount', '-first', '-head', '-tail', '-last'];

const ALTERNATIVES =
  `Use grepai_search / Grep to locate the relevant section, then Read with offset/limit. ` +
  `Read only the slice you need: Read(file_path, offset=N, limit=M). ` +
  `For broad exploration across files, dispatch the \`scout\` agent and ask for conclusions, not dumps.`;

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }) + '\n');
}

// A deny reason if reading this whole file would bloat context, else null.
function oversizeReason(filePath, verb) {
  if (!filePath || !existsSync(filePath)) return null;
  if (BINARY_EXTS.has(extname(filePath).toLowerCase())) return null;

  const { size } = statSync(filePath);
  if (size > MAX_BYTES) {
    return `${verb} blocked: "${filePath}" is ${(size / 1024).toFixed(0)} KB ` +
      `(limit 256 KB for blind reads). ${ALTERNATIVES}`;
  }
  const content = readFileSync(filePath, 'utf8');
  const lines = (content.match(/\n/g) ?? []).length + (content.endsWith('\n') ? 0 : 1);
  if (lines > MAX_LINES) {
    return `${verb} blocked: "${filePath}" has ${lines} lines ` +
      `(limit ${MAX_LINES} for blind reads). ${ALTERNATIVES}`;
  }
  return null;
}

// The file a whole-file dump command would print, or null if it is not a blind
// dump. ponytail: catches the common `cat <path>` case; misses relative paths
// after a `cd` and multi-file dumps (fail-open) — a full fix needs shell emulation.
function dumpTarget(command) {
  if (!command || /[|>]/.test(command)) return null; // piped/redirected → filtered, not context bloat
  const seg = command.split(/&&|;/).pop().trim();
  const m = seg.match(/^(\S+)\s+(.+)$/);
  if (!m || !DUMP_CMDS.has(m[1].toLowerCase())) return null;
  const rest = m[2];
  if (BOUND_FLAGS.some((f) => rest.toLowerCase().includes(f))) return null;
  // First non-flag argument = the file (tolerates quotes and leading flags).
  const a = rest.match(/(?:^|\s)(?!-)(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return a ? (a[1] || a[2] || a[3]) : null;
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

  const input = payload.tool_input ?? {};

  if (payload.tool_name === 'Read') {
    // Allow if offset or limit is specified (targeted read)
    if (input.offset != null || input.limit != null) process.exit(0);
    const reason = oversizeReason(input.file_path, 'Read');
    if (reason) deny(reason);
    process.exit(0);
  }

  if (payload.tool_name === 'Bash' || payload.tool_name === 'PowerShell') {
    const target = dumpTarget(input.command);
    if (target) {
      const reason = oversizeReason(target, 'Full-file dump');
      if (reason) deny(reason);
    }
    process.exit(0);
  }

  process.exit(0);

} catch {
  // Any internal error → allow silently
  process.exit(0);
}
