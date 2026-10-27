// Status line + on-demand band: plugin and grepai health, token savings (session and project) go to
// this plugin's status line; the band above the prompt shows only for a grepai action, an error, or /te.
// All logic lives in scripts/band-status.mjs (testable Node); this module only runs it and draws.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BandStatus, Savings } from '../types'

const status = atom({ plugin: 'token-economy', key: 'status' } as const, null)
const busy = atom({ plugin: 'token-economy', key: 'busy' } as const, null)
const error = atom({ plugin: 'token-economy', key: 'error' } as const, null)
const panel = atom({ plugin: 'token-economy', key: 'panel' } as const, null)
const hidden = atom({ plugin: 'token-economy', key: 'hidden' } as const, [])

const SEGMENTS = ['te', 'grepai', 'session', 'project'] as const
type Segment = (typeof SEGMENTS)[number]

const script = ($: EngineInterface) => `${$.plugin.root}/scripts/band-status.mjs`

async function refresh($: EngineInterface) {
  try {
    const [cwd, session, model] = await Promise.all([$.session.root(), $.session.id(), $.session.model()])
    const r = await $.process.run(['node', script($), '--cwd', cwd, '--session', session, '--model', model], { timeoutMs: 10000 })
    await update($, status, () => JSON.parse(r.stdout) as BandStatus)
    await update($, error, () => null)
  } catch (err) {
    await update($, error, () => `status failed: ${String(err).slice(0, 80)}`)
  }
  await publishStatus($)
}

// The everyday view: one status line with the shown segments. The band is only for actions.
async function publishStatus($: EngineInterface) {
  const s = await read($, status)
  if (!s?.grepai || !s.plugin || !s.savings) return
  const off = await read($, hidden)
  const seg = segments(s)
  $.ui.status(SEGMENTS.filter(id => !off.includes(id)).map(id => seg[id].text).join(' │ ') || undefined)
}

// Runs grepai commands in order, stops at the first failure, then refreshes. A press hook has a
// 10 s budget and init + watch can take longer: buttons start this without awaiting it.
async function act($: EngineInterface, label: string, steps: string[][]) {
  await update($, busy, () => label)
  try {
    const cwd = await $.session.root()
    for (const argv of steps) {
      const r = await $.process.run(argv, { cwd, timeoutMs: 60000 })
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

async function toggleSegment($: EngineInterface, id: Segment) {
  const after = await update($, hidden, h => (h.includes(id) ? h.filter(x => x !== id) : [...h, id]))
  await $.store.set('hidden', after)
  await publishStatus($)
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

function grepaiTip(g: BandStatus['grepai']) {
  if (g.running) return 'grepai watch is running: the semantic index follows your edits.'
  if (g.reason?.startsWith('model ')) return `The watcher is stopped and Ollama lacks the embedding model: ollama pull ${g.reason.split(' ')[1]}`
  return GREPAI_TIPS[g.reason ?? ''] ?? 'grepai state unknown.'
}

// Segment text and its one-line explanation, for the current status.
function segments(s: BandStatus): Record<Segment, { text: string; tip: string }> {
  const g = s.grepai
  const o = s.plugin.options ?? {}
  return {
    te: s.plugin.seen
      ? { text: `● TE ${s.plugin.version ?? ''}`, tip: `TE: token-economy hooks ran at this session's start (read budget ${o.read_budget}, Explore on ${o.explore_model}, policy ${o.inject_policy ? 'on' : 'off'}, grepai autostart ${o.grepai_autostart ? 'on' : 'off'}).` }
      : { text: '○ TE hooks', tip: 'TE: no session-start record from token-economy for this session. The plugin is disabled, or the installed version predates this band (the read-guard may still be active).' },
    grepai: { text: g.running ? '● grepai' : `○ grepai: ${g.reason ?? 'unknown'}`, tip: `grepai: ${grepaiTip(g)}` },
    session: { text: `session ${money(s.savings.session)}`, tip: 'session: tokens kept out of context by blocked whole-file Reads (upper bound); net subtracts the slices read afterwards; ~$ is net at the session model input price, counted once.' },
    project: { text: `project ${money(s.savings.project)}`, tip: 'project: the same, summed over every session in this project.' },
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'te', description: 'Open the token-economy band: segment explanations and picker' })
    const saved = await $.store.get('hidden')
    if (Array.isArray(saved)) await update($, hidden, () => saved.filter((x): x is string => typeof x === 'string'))
    await refresh($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('command.run', { command: 'te' }, async $ => {
    await update($, panel, () => 'help')
    return { text: 'token-economy band opened above the prompt.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, status)
    // A status kept from an older version of this module may lack fields: wait for the next refresh.
    if (e.props.hasSurvey || !s?.grepai || !s.plugin || !s.savings) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const [working, problem, open, off] = await Promise.all([read($, busy), read($, error), read($, panel), read($, hidden)])
    const g = s.grepai
    // Absolute path resolved by band-status outside the repo: never a bare 'grepai' (cwd lookup on Windows).
    const bin = g.bin
    const seg = segments(s)
    const shown = SEGMENTS.filter(id => !off.includes(id))
    const togglePanel = (p: 'help' | 'settings') => () => void update($, panel, cur => (cur === p ? null : p))
    // The card above the prompt is shared with other plugins: draw only when there is something to do
    // (a grepai action, work in progress, an error) or when the user opened it with /te.
    const actionable = Boolean(bin) && !g.running && (!g.config || g.running === false)
    if (!actionable && !working && !problem && !open) {
      return next(e)
    }

    const grepaiButtons = working ? (
      <Text dimColor>{working}… </Text>
    ) : (
      <Box>
        {[
          bin && !g.config ? (
            <Button
              key="init"
              label="Init (creates .grepai/, edits .gitignore)"
              onPress={() => void act($, 'init', [[bin, 'init', '--yes'], [bin, 'watch', '--background']])}
            />
          ) : null,
          bin && g.config && g.running === false ? (
            <Button key="start" label="Start" onPress={() => void act($, 'start', [[bin, 'watch', '--background']])} />
          ) : null,
          !g.running ? <Button key="retry" label="Retry" onPress={() => void refresh($)} /> : null,
        ].filter(b => b !== null)}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>TE {seg.grepai.text} </Text>
          {g.running ? null : grepaiButtons}
          <Text> </Text>
          <Button key="help" label="?" onPress={togglePanel('help')} />
          <Button key="settings" label="⚙" onPress={togglePanel('settings')} />
          {open ? <Button key="close" label="✕" onPress={() => void update($, panel, () => null)} /> : null}
          {problem ? <Text color="red"> {problem}</Text> : null}
        </Box>
        {open === 'help' ? shown.map(id => <Text key={`tip-${id}`} dimColor>{seg[id].tip}</Text>) : null}
        {open === 'settings' ? (
          <Box>
            <Text dimColor>Show: </Text>
            {SEGMENTS.map(id => (
              <Button
                key={`toggle-${id}`}
                label={`${off.includes(id) ? '☐' : '☑'} ${id}`}
                onPress={() => void toggleSegment($, id)}
              />
            ))}
          </Box>
        ) : null}
      </Box>
    )
  })
}
