// Status band above the prompt: plugin and grepai health, token savings (session and project).
// All logic lives in scripts/band-status.mjs (testable Node); this module only runs it and draws.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BandStatus, Savings } from '../types'

const status = atom({ plugin: 'token-economy', key: 'status' } as const, null)
const busy = atom({ plugin: 'token-economy', key: 'busy' } as const, null)
const error = atom({ plugin: 'token-economy', key: 'error' } as const, null)

const script = ($: EngineInterface) => `${$.plugin.root}/scripts/band-status.mjs`

async function refresh($: EngineInterface) {
  try {
    const [cwd, session, model] = await Promise.all([$.session.root(), $.session.id(), $.session.model()])
    const r = await $.process.run(['node', script($), '--cwd', cwd, '--session', session, '--model', model], { timeout: 10000 })
    await update($, status, () => JSON.parse(r.stdout) as BandStatus)
    await update($, error, () => null)
  } catch (err) {
    await update($, error, () => `status failed: ${String(err).slice(0, 80)}`)
  }
}

// Runs grepai commands in order, stops at the first failure, then refreshes. A press hook has a
// 10 s budget and init + watch can take longer: buttons start this without awaiting it.
async function act($: EngineInterface, label: string, steps: string[][]) {
  await update($, busy, () => label)
  try {
    const cwd = await $.session.root()
    for (const argv of steps) {
      const r = await $.process.run(argv, { cwd, timeout: 60000 })
      if (r.exitCode !== 0) {
        const why = (r.stderr || r.stdout).trim().split('\n')[0] ?? ''
        await update($, error, () => `${argv.slice(1, 2).join(' ')}: ${why.slice(0, 80)}`)
        break
      }
    }
  } catch (err) {
    await update($, error, () => `${label} failed: ${String(err).slice(0, 80)}`)
  }
  await update($, busy, () => null)
  await refresh($)
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const usd = (s: Savings) => (s.usd == null ? '' : ` ~$${s.usd.toFixed(2)}`)
const money = (s: Savings) => `≤${k(s.upper)}${s.followups ? ` (net ${k(s.net)})` : ''}${usd(s)}`

const GREPAI_TIPS: Record<string, string> = {
  'no config': 'This project has no .grepai/config.yaml: semantic search is off. Init creates it (local Ollama embeddings) and starts the watcher.',
  'grepai not installed': 'No grepai executable on PATH (a copy inside the project is ignored on purpose). Install grepai to enable semantic search.',
  'daemon stopped': 'grepai is configured but its watcher is not running, so the index goes stale. Start launches grepai watch in the background.',
  'Ollama unreachable': 'The watcher is stopped and the Ollama server in .grepai/config.yaml does not answer. Start Ollama, then Retry.',
  'status check failed': 'grepai watch --status failed or timed out. Retry, or run it in a terminal to see why.',
}

// One line per segment, shown on hover: what the segment means right now.
function tips(s: BandStatus) {
  const g = s.grepai
  const o = s.plugin.options ?? {}
  return {
    plugin: s.plugin.seen
      ? `token-economy hooks ran at this session's start (v${s.plugin.version ?? '?'}: read budget ${o.read_budget}, Explore on ${o.explore_model}, policy ${o.inject_policy ? 'on' : 'off'}, grepai autostart ${o.grepai_autostart ? 'on' : 'off'}).`
      : "No session-start record from token-economy for this session: the plugin is disabled, or the installed version predates the heartbeat. The read-guard may still be active.",
    grepai: g.running
      ? 'grepai watch is running: the semantic index follows your edits.'
      : GREPAI_TIPS[g.reason ?? ''] ?? (g.reason?.startsWith('model ') ? `The watcher is stopped and Ollama lacks the embedding model: ollama pull ${g.reason.split(' ')[1]}` : 'grepai state unknown.'),
    session: 'Tokens kept out of context in this session by blocked whole-file Reads (upper bound). net subtracts the slices read afterwards; ~$ is net at the session model input price, counted once.',
    project: 'Same as session, summed over every session in this project.',
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, status)
    if (e.props.hasSurvey || s === null) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const working = await read($, busy)
    const problem = await read($, error)
    const g = s.grepai
    // Absolute path resolved by band-status outside the repo: never a bare 'grepai' (cwd lookup on Windows).
    const bin = g.bin
    const tip = tips(s)
    // A segment lights its hover group; the matching hidden line below is revealed while it is hovered.
    const seg = (id: keyof typeof tip, text: string) => (
      <Box key={`seg-${id}`} hover={{ scope: `te-${id}` }}>
        <Text dimColor>{text}</Text>
      </Box>
    )
    const reveal = (id: keyof typeof tip) => (
      <Box key={`tip-${id}`} display="none" hover={{ scope: `te-${id}`, display: 'flex' }}>
        <Text>{tip[id]}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box>
          {seg('plugin', s.plugin.seen ? `● TE ${s.plugin.version ?? ''}` : '○ TE hooks')}
          <Text dimColor> │ </Text>
          {seg('grepai', g.running ? '● grepai' : `○ grepai: ${g.reason ?? 'unknown'}`)}
          <Text> </Text>
          {working ? <Text dimColor>{working}… </Text> : null}
          {!working && bin && !g.config ? (
            <Button
              key="init"
              label="Init (creates .grepai/, edits .gitignore)"
              onPress={() => void act($, 'init', [[bin, 'init', '--yes'], [bin, 'watch', '--background']])}
            />
          ) : null}
          {!working && bin && g.config && g.running === false ? (
            <Button key="start" label="Start" onPress={() => void act($, 'start', [[bin, 'watch', '--background']])} />
          ) : null}
          {!working && !g.running ? <Button key="retry" label="Retry" onPress={() => void refresh($)} /> : null}
          <Text dimColor> │ </Text>
          {seg('session', `session ${money(s.savings.session)}`)}
          <Text dimColor> │ </Text>
          {seg('project', `project ${money(s.savings.project)}`)}
          {problem ? <Text color="red"> {problem}</Text> : null}
        </Box>
        {reveal('plugin')}
        {reveal('grepai')}
        {reveal('session')}
        {reveal('project')}
      </Box>
    )
  })
}
