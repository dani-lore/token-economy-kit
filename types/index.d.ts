// What scripts/band-status.mjs prints; the status band renders it.
export type Savings = { upper: number; net: number; denies: number; followups: number; usd: number | null }

export type BandStatus = {
  grepai: { config: boolean; running: boolean | null; reason: string | null; bin: string | null }
  plugin: { seen: boolean; version: string | null; options: Record<string, unknown> | null }
  savings: { session: Savings; project: Savings }
  modes: { ponytail: string | null; caveman: string | null }
}

declare module 'claude-code' {
  interface PluginState {
    'token-economy': {
      status: BandStatus | null
      busy: string | null
      error: string | null
      // Which panel is open under the band: explanations, segment toggles, or none.
      panel: 'help' | 'settings' | null
      // Segments the user hid; mirrored in $.store so the choice outlives the session.
      hidden: string[]
    }
  }
}
