// PreToolUse hook (matcher: Agent|Task): routes the built-in Explore subagent
// to a cheap model. Explore inherits the main model by default; a call with an
// explicit `model` is left alone. Contract: no stdout = untouched; otherwise
// allow + updatedInput (the full original input plus model and a report contract).

import { readPayload } from './stdin.mjs';

const MODELS = new Set(['haiku', 'sonnet', 'opus', 'fable']);
const CONTRACT = 'Report conclusions with path:line references. Do not paste file contents or list every file you opened.';

try {
  const payload = await readPayload();
  const input = payload?.tool_input;
  const option = (process.env.CLAUDE_PLUGIN_OPTION_EXPLORE_MODEL ?? '').trim().toLowerCase();
  if (
    ['Agent', 'Task'].includes(payload?.tool_name) &&
    String(input?.subagent_type).toLowerCase() === 'explore' &&
    input.model == null &&
    option !== 'inherit'
  ) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          ...input,
          model: MODELS.has(option) ? option : 'haiku',
          prompt: `${input.prompt ?? ''}\n\n${CONTRACT}`,
        },
      },
    }) + '\n');
  }
  process.exit(0);
} catch {
  // Any internal error → leave the call untouched
  process.exit(0);
}
