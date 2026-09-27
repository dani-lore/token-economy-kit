# AGENTS.md

Guida per lavorare **su** questo repo. Il protocollo d'uso dei tool che il plugin
inietta a runtime non si ripete qui: questo file riguarda lo sviluppo del plugin.

## Panoramica

`token-economy-kit` è un plugin per Claude Code (marketplace `dani-lore/token-economy-kit`,
plugin `token-economy`, versione in `.claude-plugin/plugin.json`) che riduce il bloat di contesto
**in ingresso**: blocca le Read integrali oltre un budget di token, instrada il subagent Explore su un
modello economico, inietta una policy di esplorazione a inizio sessione e fornisce skill e comandi.

Node ESM puro, **zero dipendenze**: nessun `node_modules`, nessun build step, nessun linter.

## Comandi

```
npm test                                  # node --test "tests/*.test.mjs"
npm run bench                             # node benchmarks/score.mjs --out → benchmarks/results/<data>.md (gitignored)
node benchmarks/score.mjs --dir <path>    # bench su una directory arbitraria, solo stdout
```

Il glob in `npm test` è espanso dal test runner di Node: serve Node 21+ (la CI usa 22).
CI: `.github/workflows/test.yml`, matrice ubuntu + windows.

Per provare il plugin in locale, dentro una sessione Claude Code:

```
/plugin marketplace add C:\path\to\token-economy-kit
/plugin install token-economy@token-economy
```

## Architettura

`hooks/hooks.json` registra tre hook, con i path espressi via `${CLAUDE_PLUGIN_ROOT}`:

- **PreToolUse** `Read` → `hooks/read-guard.mjs`. Nega la Read senza `limit` ≤ 600 quando i token
  stimati dalla dimensione (`ceil(bytes/4)`) superano `READ_MAX_TOKENS`; il messaggio contiene la mappa
  (heading o dichiarazioni a colonna 0) letta da un prefisso di 2 MB. Salta le estensioni in `SKIP_EXTS`.
- **PreToolUse** `Agent|Task` → `hooks/explore-router.mjs`. Aggiunge `model` e un contratto di risposta
  alle chiamate Explore senza `model`, via `permissionDecision: "allow"` + `updatedInput`.
- **SessionStart** → `hooks/session-start.mjs`. Policy in `additionalContext`, adattata alla presenza di
  `.grepai/config.yaml` risalendo dalla cwd; con `source` `startup`/`resume` avvia `grepai watch --background`
  e lo annuncia in `systemMessage`.

`hooks/limits.mjs` è la **fonte unica** delle soglie e del modello dei costi (budget, slice, cap nativi della
Read, `logDir()`): lo importano read-guard, session-start, `benchmarks/score.mjs` e `scripts/economy-stats.mjs`.
`hooks/stdin.mjs` legge il payload togliendo il BOM.

Altri componenti, auto-discovery da directory: `skills/exploring-codebase/` (protocollo + `references/mcp-pruning.md`),
`commands/` (`/context-audit`, `/economy-stats`, `/economy-help`). `scripts/economy-stats.mjs` è lo script
dietro `/economy-stats`. Le opzioni sono in `userConfig` di `plugin.json`.

## Contratto degli hook

Vale per tutti e tre, ed è ciò che i test verificano:

- **Nessun effetto** = exit 0 con stdout vuoto; **decisione** = exit 0 con un JSON su stdout. Un exit code
  diverso da 0 non è il canale del rifiuto.
- **Fail-open**: qualunque errore interno (stdin malformato, file inesistente, telemetria non scrivibile)
  termina in exit 0 silenzioso. Un guardrail che blocca il lavoro per un bug fa più danni dello spreco che previene.
- Ogni deny del read-guard appende `{ t, project, path, lines, bytes, saved }` a `denied.jsonl` in
  `CLAUDE_PLUGIN_DATA` (fallback `~/.claude/token-economy`), mai nel repo dell'utente. Il fallimento del log
  non deve alterare la decisione.

## Gotcha

- Modificare hook, skill o comandi **non ha effetto sulla sessione in corso**: serve una nuova
  sessione (o `/reload-plugins`). La cache installata si aggiorna solo se cambia `version` in `plugin.json`.
- Test ermetici: ogni hook lanciato nei test riceve `CLAUDE_PLUGIN_DATA` in una temp dir, `cwd` in una temp dir
  e nessuna `CLAUDE_PLUGIN_OPTION_*` ereditata dalla shell. Se compare telemetria nel repo o in `~/.claude`, un test è sbagliato.
- I test di session-start girano con `PATH` vuoto, così non parte mai un daemon grepai vero; il ramo di avvio
  è coperto solo su POSIX con uno script `grepai` finto.
- Windows e POSIX sono entrambi target di CI: niente path hardcoded, niente shell (`spawn` senza `shell: true`),
  stdin ripulito dal BOM UTF-8 che PowerShell antepone.
- Altri plugin con un PreToolUse su `Agent` che restituisce `updatedInput` (es. context-mode) vincono sul router.
- `benchmarks/results/<data>.md` è auto-generato e gitignored; i report curati con nome diverso sono versionati.

## Vincoli

- Nessuna dipendenza runtime. Solo standard library Node: il plugin deve installarsi senza `npm install`.
- Mai usare path assoluti o relativi al cwd per raggiungere file del plugin: sempre `${CLAUDE_PLUGIN_ROOT}`.
- Mai duplicare una soglia fuori da `limits.mjs`.
- Mai rendere un hook bloccante o lento: l'avvio del watcher è fire-and-forget (`--status` con timeout 3 s),
  `read-guard` non legge il contenuto di un file che resta sotto il budget.
- Ogni nuovo comportamento di un hook ha il suo test in `tests/`.
- `README.md` (inglese) e `README.it.md` (italiano) vanno tenuti in parità di contenuto; skill e `CHANGELOG.md` in inglese.
- Documentazione in italiano; codice, nomi e commenti inline in inglese.
- I piani di lavoro stanno in `.claude/plans/<data>-<nome>.md`.

## Environment variables

- `CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS` — budget in token del read-guard (default 10000).
- `CLAUDE_PLUGIN_OPTION_INJECT_POLICY` — `0`/`false` spegne la policy; alias legacy `TOKEN_ECONOMY_INJECT`.
- `CLAUDE_PLUGIN_OPTION_GREPAI_AUTOSTART` — `0`/`false` spegne l'autostart; alias legacy `GREPAI_WATCH_AUTOSTART`.
- `CLAUDE_PLUGIN_OPTION_EXPLORE_MODEL` — `haiku`/`sonnet`/`opus`/`fable`/`inherit` (default `haiku`).
- `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` — cap nativo della Read, letto da `limits.mjs` (default 25000).
- `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR` — fornite da Claude Code agli hook.
