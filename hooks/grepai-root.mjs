// Nearest directory at or above `cwd` initialized by `grepai init`, else null;
// and the grepai binary to run there.

import { existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute, relative, delimiter } from 'node:path';

export function grepaiRoot(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.grepai', 'config.yaml'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

const inside = (dir, root) => {
  const rel = relative(resolve(root), resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// Absolute path of grepai from PATH, else null. On Windows a bare name in spawn is looked up in the
// cwd first, so a repo could plant its own grepai.exe: only absolute PATH entries outside `root`
// count, and only .exe (a .cmd/.bat shim cannot run without a shell anyway).
export function grepaiBin(root) {
  const name = process.platform === 'win32' ? 'grepai.exe' : 'grepai';
  const path = process.env.PATH ?? process.env.Path ?? '';
  for (const dir of path.split(delimiter)) {
    if (!dir || !isAbsolute(dir) || (root && inside(dir, root))) continue;
    const file = join(dir, name);
    try { if (statSync(file).isFile()) return file; } catch { /* next */ }
  }
  return null;
}
