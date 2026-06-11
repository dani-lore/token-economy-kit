// PreToolUse hook: blocks blind full-file Reads on large text files.
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

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }) + '\n');
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

  // Only intercept Read tool
  if (payload.tool_name !== 'Read') process.exit(0);

  const input = payload.tool_input ?? {};

  // Allow if offset or limit is specified (targeted read)
  if (input.offset != null || input.limit != null) process.exit(0);

  const filePath = input.file_path;
  if (!filePath || !existsSync(filePath)) process.exit(0);

  // Allow binary/special extensions
  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTS.has(ext)) process.exit(0);

  // Size check — avoids reading huge files into memory
  const { size } = statSync(filePath);
  if (size > MAX_BYTES) {
    deny(
      `Read blocked: "${filePath}" is ${(size / 1024).toFixed(0)} KB (limit 256 KB for blind reads). ` +
      `Use grepai_search / Grep to locate the relevant section, then Read with offset/limit. ` +
      `Read only the slice you need: Read(file_path, offset=N, limit=M). ` +
      `For broad exploration across files, dispatch the \`scout\` agent and ask for conclusions, not dumps.`
    );
    process.exit(0);
  }

  // Line count
  const content = readFileSync(filePath, 'utf8');
  const lines = (content.match(/\n/g) ?? []).length + (content.endsWith('\n') ? 0 : 1);

  if (lines <= MAX_LINES) process.exit(0);

  deny(
    `Read blocked: "${filePath}" has ${lines} lines (limit ${MAX_LINES} for blind reads). ` +
    `Use grepai_search / Grep to locate the relevant section, then Read with offset/limit. ` +
    `Read only the slice you need: Read(file_path, offset=N, limit=M). ` +
    `For broad exploration across files, dispatch the \`scout\` agent and ask for conclusions, not dumps.`
  );
  process.exit(0);

} catch {
  // Any internal error → allow silently
  process.exit(0);
}
