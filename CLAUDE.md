# CLAUDE.md

Guida per lavorare **su** questo repo. Il protocollo d'uso dei tool che il plugin
inietta a runtime non si ripete qui: questo file riguarda lo sviluppo del plugin.

## Panoramica

`token-economy-kit` è un plugin per Claude Code (marketplace `dani-lore/token-economy-kit`,
plugin `token-economy`) che riduce il bloat di contesto **in ingresso**: blocca le Read cieche
di file grandi, inietta una policy di esplorazione a inizio sessione e fornisce skill, agent e
comandi per localizzare il codice invece di leggerlo per intero.

Node ESM puro, **zero dipendenze**: nessun `node_modules`, nessun build step, nessun linter.

## Comandi

```
npm test                                  # node --test "tests/*.test.mjs" — 36 test
npm run bench                             # scrive benchmarks/results/<data>.md (gitignored)
node benchmarks/score.mjs --dir <path>    # bench su una directory arbitraria
```

Il glob in `npm test` è espanso dal test runner di Node: serve Node 21+ (la CI usa 22).
Gli hook in sé girano da Node 18. CI: `.github/workflows/test.yml`, matrice ubuntu + windows.

Per provare il plugin in locale, dentro una sessione Claude Code:

```
/plugin marketplace add C:\path\to\token-economy-kit
/plugin install token-economy@token-economy
```

## Architettura

`hooks/hooks.json` è il punto di registrazione, con i path espressi via `${CLAUDE_PLUGIN_ROOT}`:

- **PreToolUse** (matcher `Read|Bash|PowerShell`) → `hooks/read-guard.mjs`. Nega la Read integrale
  di file testuali oltre `MAX_LINES` (600) o `MAX_BYTES` (256 KB), più l'euristica file densi/generati
  (`DENSE_AVG` byte/riga oltre `DENSE_BYTES`). Una Read con `offset`/`limit` passa sempre. Intercetta
  anche i dump da shell (`cat`, `type`, `Get-Content`, `gc`); comandi con pipe o redirect e flag che
  limitano l'output (`-TotalCount`, `-Tail`, …) passano.
- **SessionStart** → `hooks/inject-policy.mjs` (lo stdout viene catturato come contesto di sessione)
  e `hooks/grepai-watch.mjs` (avvia `grepai watch --background` solo se la cwd ha `.grepai/config.yaml`).

Altri componenti, auto-discovery da directory: `agents/scout.md` (model haiku, ricognizione a basso costo),
`skills/exploring-codebase/` (protocollo dettagliato + `references/mcp-pruning.md`),
`commands/` (`/context-audit`, `/economy-stats`, `/economy-help`).

`benchmarks/score.mjs` conta i token input di un corpus reale in due bracci (baseline blind Read vs
percorso guardato) con stima `ceil(bytes/4)`. Nessuna chiamata API: è puro conteggio deterministico.

## Contratto degli hook

Vale per tutti e tre, ed è ciò che i test verificano:

- **allow** = exit 0 con stdout vuoto; **deny** = exit 0 con JSON su stdout
  (`hookSpecificOutput.permissionDecision: "deny"`). Un exit code diverso da 0 non è il canale del rifiuto.
- **Fail-open**: qualunque errore interno (stdin malformato, file inesistente, telemetria non scrivibile)
  deve terminare in allow silenzioso. Un guardrail che blocca il lavoro per un bug fa più danni dello spreco che previene.
- Ogni deny appende una riga a `.claude/token-economy/denied.jsonl` nella **cwd della sessione**
  (gitignored). È la fonte di `/economy-stats`; il fallimento del log non deve mai alterare la decisione.

## Gotcha

- Modificare hook, agent, skill o comandi **non ha effetto sulla sessione in corso**: serve una nuova
  sessione (o `/reload-plugins`). Un test che "non vede" la modifica di solito è questo.
- I test lanciano gli hook come sottoprocessi passando JSON su stdin, con `cwd` in una temp dir per
  restare ermetici. Se un test scrive telemetria nella root del repo, la `cwd` è sbagliata.
- Windows e POSIX sono entrambi target di CI: niente path hardcoded, niente shell (`spawn` senza `shell: true`),
  e lo stdin va ripulito dal BOM UTF-8 che PowerShell antepone.
- Le soglie sono duplicate in `benchmarks/score.mjs`: cambiandole in `read-guard.mjs` vanno riallineate lì,
  altrimenti il bench misura un guardrail che non esiste.
- `benchmarks/results/<data>.md` è auto-generato e gitignored; i report curati con nome diverso sono versionati.

## Vincoli

- Nessuna dipendenza runtime. Solo standard library Node: il plugin deve installarsi senza `npm install`.
- Mai usare path assoluti o relativi al cwd per raggiungere file del plugin: sempre `${CLAUDE_PLUGIN_ROOT}`.
- Mai rendere un hook bloccante o lento: `grepai-watch` è fire-and-forget, `read-guard` non deve leggere
  il contenuto di un file già escluso per dimensione.
- Ogni nuovo comportamento di un hook ha il suo test in `tests/`.
- `README.md` (inglese) e `README.it.md` (italiano) vanno tenuti in parità di contenuto.
- Documentazione in italiano; codice, nomi e commenti inline in inglese.
- I piani di lavoro stanno in `.claude/plans/<data>-<nome>.md`.

## Environment variables

- `TOKEN_ECONOMY_INJECT` — `0` disattiva l'iniezione della policy a SessionStart.
- `GREPAI_WATCH_AUTOSTART` — `0` disattiva l'autostart di `grepai watch`.
- `CLAUDE_PLUGIN_ROOT` — fornita da Claude Code, radice del plugin nei comandi di `hooks.json`.
