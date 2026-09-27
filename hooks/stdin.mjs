// Hook payload from stdin: parsed JSON, or null when empty/malformed.
// Event-based read works on Windows PowerShell pipes; the UTF-8 BOM that
// PowerShell prepends is stripped before parsing.

export function readPayload() {
  return new Promise((resolve) => {
    const chunks = [];
    const done = () => {
      const raw = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
      try { resolve(JSON.parse(raw)); } catch { resolve(null); }
    };
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', done);
    process.stdin.on('error', () => resolve(null));
    // If stdin is already closed/empty (TTY), resolve immediately
    if (process.stdin.readableEnded) resolve(null);
  });
}
