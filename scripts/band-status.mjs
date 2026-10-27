// One JSON object for a UI band: grepai health, plugin heartbeat, token savings.
//
//   node scripts/band-status.mjs --cwd <dir> [--session <id>] [--model <id>] [--data <dir>]
//
// Never throws: on any error the best partial object is printed, exit 0.

import { parseArgs } from 'node:util';
import { grepaiRoot, grepaiBin } from '../hooks/grepai-root.mjs';
import { watcherState, diagnoseStopped } from './band-grepai.mjs';
import { dataDirs, savings, heartbeat } from './band-savings.mjs';

const zero = () => ({ upper: 0, net: 0, denies: 0, followups: 0, usd: null });

const out = {
  grepai: { config: false, running: null, reason: null, bin: null },
  plugin: { seen: false, version: null, options: null },
  savings: { session: zero(), project: zero() },
};

async function grepaiStatus(cwd) {
  const root = grepaiRoot(cwd);
  // Absolute path, never resolved from the repo: the band runs it as is (see grepaiBin).
  const bin = grepaiBin(root ?? cwd);
  if (!bin) return { config: !!root, running: null, reason: 'grepai not installed', bin: null };
  if (!root) return { config: false, running: null, reason: 'no config', bin };
  out.grepai.config = true;
  const state = watcherState(root, bin);
  if (state.running === false) state.reason = await diagnoseStopped(root);
  return { config: true, ...state, bin };
}

try {
  const { values } = parseArgs({
    options: { cwd: { type: 'string' }, session: { type: 'string' }, model: { type: 'string' }, data: { type: 'string' } },
    strict: false,
  });
  const cwd = values.cwd || process.cwd();
  const dirs = dataDirs(values.data);
  try { out.grepai = await grepaiStatus(cwd); } catch { /* keep partial */ }
  try {
    const hb = heartbeat(dirs, { cwd, session: values.session });
    if (hb) out.plugin = { seen: true, version: hb.version ?? null, options: hb.options ?? null };
  } catch { /* keep partial */ }
  try { out.savings = savings(dirs, { cwd, session: values.session, model: values.model }); } catch { /* keep partial */ }
} catch { /* print what we have */ }

process.stdout.write(JSON.stringify(out) + '\n');
process.exit(0);
