# token-economy

[![test](https://github.com/dani-lore/token-economy-kit/actions/workflows/test.yml/badge.svg)](https://github.com/dani-lore/token-economy-kit/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> English version: [README.md](README.md)

Plugin per Claude Code che tiene bassi i token in ingresso: blocca le Read
integrali dei file grandi e indica la porzione da leggere, manda il subagent
Explore su un modello più economico e dà a ogni sessione una breve policy di
esplorazione.

## 1. Installazione in 30 secondi

Dentro una sessione Claude Code:

```
/plugin marketplace add dani-lore/token-economy-kit
/plugin install token-economy@token-economy
```

Poi apri una nuova sessione (oppure `/reload-plugins`).

**Verifica che funzioni:**

- `/economy-help` mostra la scheda di riferimento del plugin.
- `/hooks` elenca `read-guard.mjs`, `explore-router.mjs` e `session-start.mjs`.
- Chiedi a Claude di leggere per intero un file grande (un lockfile, un changelog
  lungo): la Read viene bloccata e il messaggio contiene la mappa del file.

## 2. Cosa fa

| Componente | Tipo | Cosa fa |
|---|---|---|
| `read-guard` | Hook PreToolUse (`Read`) | Nega la Read integrale quando la stima del file supera il budget di token (default 10.000). Una Read con `limit` fino a 600 righe passa sempre. Il rifiuto riporta la mappa del file con i numeri di riga. |
| `explore-router` | Hook PreToolUse (`Agent`) | Un subagent Explore lanciato senza modello gira su uno più economico (default `haiku`) e deve rispondere con conclusioni `path:riga` invece che con il contenuto dei file. |
| `session-start` | Hook SessionStart | Inietta una policy di esplorazione di sette righe, adattata al fatto che il progetto usi grepai, e avvia `grepai watch` nei progetti grepai. |
| `exploring-codebase` | Skill | Il protocollo dettagliato, caricato su richiesta: quale strumento per quale domanda, quando la Read diretta è giusta, quando delegare a Explore. |
| `/context-audit` | Comando | Quanti token in ingresso toglierebbe il guard nel repo corrente (un tetto massimo). |
| `/economy-stats` | Comando | Risparmi registrati davvero dal guard al momento del rifiuto, per questo progetto e per tutti. |
| `/economy-help` | Comando | Scheda di riferimento: componenti, comandi, opzioni. |

Un rifiuto reale, prodotto da `read-guard` su un file di
[microsoft/vscode-python](https://github.com/microsoft/vscode-python) (mappa
accorciata qui, aveva 14 voci):

```
Read blocked: "src/client/telemetry/index.ts" is ~31096 tokens (2582 lines); whole-file reads are capped at 10000 tokens. Read the part you need with offset/limit (limit ≤ 600), located via the outline below or Grep.
Outline:
L23 function isTelemetrySupported(): boolean {
L40 export function isTelemetryDisabled(): boolean {
L49 const sharedProperties: Record<string, unknown> = {};
L53 export function setSharedProperty<P extends ISharedPropertyMapping, E extends ke
L76 export function getTelemetryReporter(): TelemetryReporter {
```

A quel punto il modello può fare, per esempio, una Read con `offset: 40, limit: 60` invece di leggere tutto il file.

## 3. Configurazione

Le opzioni si impostano in `/config`, tra le opzioni del plugin:

| Opzione | Default | Effetto | Alias env legacy |
|---|---|---|---|
| `read_max_tokens` | `10000` (min `2000`) | Le Read integrali stimate oltre questo numero di token vengono bloccate. | — |
| `inject_policy` | `true` | Inietta la policy di esplorazione a inizio sessione. | `TOKEN_ECONOMY_INJECT=0` |
| `grepai_autostart` | `true` | Avvia `grepai watch` in background nei progetti con `.grepai/config.yaml`. | `GREPAI_WATCH_AUTOSTART=0` |
| `explore_model` | `haiku` | Modello dei subagent Explore lanciati senza modello: `haiku`, `sonnet`, `opus`, `fable`, oppure `inherit` per tenere il modello principale. | — |

Un interruttore è spento quando l'opzione oppure la sua variabile legacy vale `0` o `false`.

Con `inject_policy` spento puoi mettere la policy nel tuo `CLAUDE.md`. Questo è
il testo che l'hook inietta in un progetto grepai:

```
Every tool result stays in context for the rest of the session, so fetch less.
Locate with grepai_search first (compact: true for locations only), then Grep/Glob for exact strings.
Read to act, in slices: offset/limit (limit ≤ 600); whole-file reads over ~10k tokens are blocked by a hook.
Wide questions that need many files read: delegate to the Explore subagent and ask for path:line conclusions; small lookups are cheaper done directly.
Long command output: filter at the source (grep, head, quiet flags).
Full protocol: skill exploring-codebase.
```

Senza grepai la seconda riga diventa "Locate with Grep/Glob instead of exploratory Reads."

## 4. Come funziona

- **Enforcement, non consigli.** Una regola in `CLAUDE.md` viene seguita quasi
  sempre e dimenticata sotto pressione; nessuna riga di prompt può impedire una
  Read. Un hook PreToolUse gira nell'harness prima di ogni chiamata e la nega in
  modo deterministico. La policy è il consiglio; `read-guard` è l'enforcement.
- **Fail-open.** Qualsiasi errore interno (input malformato, file mancante, log
  non scrivibile) lascia passare la chiamata. Un guardrail che blocca il lavoro
  per un suo bug fa più danni dello spreco che previene.
- **Un budget in token, non in righe.** Le righe sono un cattivo indicatore: 900
  righe corte costano circa 2.000 token, 50 righe minificate possono costarne
  25.000. Il guard stima i token dalla dimensione del file (`byte / 4`) senza
  leggerlo, e ne legge solo un prefisso per contare le righe e costruire la mappa
  dopo aver deciso il rifiuto.
- **Limiti nativi della Read.** La Read di Claude Code restituisce già al massimo
  2.000 righe e tronca l'output oltre un tetto di token (25.000 di default,
  `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`). Una Read cieca di un file grande
  porta comunque in contesto fino a quella quantità di testo in gran parte
  inutile; il rifiuto costa qualche centinaio di token e indica la porzione da leggere.
- **Instradamento di Explore.** Il subagent Explore integrato è in sola lettura e
  salta i `CLAUDE.md`, ma eredita il modello della sessione principale.
  `explore-router` aggiunge un `model` (default `haiku`) alle chiamate Explore che
  non ne hanno e una riga di contratto sul formato della risposta. Una chiamata con
  `model` esplicito resta intatta.
- **Autostart di grepai.** All'avvio o alla ripresa della sessione, in un progetto
  con `.grepai/config.yaml` (cercato risalendo dalla cwd), l'hook controlla
  `grepai watch --status` e, se nessun watcher è attivo, lancia
  `grepai watch --background` e te lo segnala. Il daemon resta attivo dopo la fine
  della sessione; si ferma con `grepai watch --stop`.

## 5. Numeri

Il risparmio è in ingresso (token spesi a leggere) e cresce con la quantità di
materiale sovradimensionato presente nel repo. Misurato da
[`benchmarks/score.mjs`](benchmarks/score.mjs), deterministico, senza chiamate
API, con entrambi i bracci limitati come la Read nativa:

| corpus | file oltre il budget | taglio dei token in ingresso (tetto) |
|---|--:|--:|
| template applicativo pulito ([fastapi](https://github.com/fastapi/full-stack-fastapi-template)) | 3 / 238 | **4,1%** |
| codebase di media taglia ([vscode-python](https://github.com/microsoft/vscode-python)) | 20 / 1.464 | **9,5%** |

È il tetto rimovibile (ogni file letto alla cieca una volta), non il risparmio di
una sessione media, e vale ~0% nei repo dove tutti i file sono piccoli. Dettagli e
cifre per file:
[benchmarks/results/2026-09-27-input-bloat.md](benchmarks/results/2026-09-27-input-bloat.md);
metodo e limiti: [benchmarks/README.md](benchmarks/README.md). `/context-audit`
esegue la stessa misura sul tuo repo, `/economy-stats` mostra ciò che il guard ha
registrato davvero.

## 6. Privacy

Tutto resta sulla tua macchina; nulla viene inviato altrove. Ogni rifiuto aggiunge
una riga a `denied.jsonl` nella directory dati del plugin
(`~/.claude/plugins/data/token-economy-token-economy/`) con: timestamp, directory
del progetto, path del file come passato alla Read, numero di righe, dimensione in
byte, token risparmiati stimati. Nessun contenuto dei file. La directory viene
cancellata quando disinstalli il plugin, e il file si può eliminare in qualsiasi momento.

## 7. Compatibilità

- Sviluppato su Claude Code 2.1 (si aggiorna con `claude update`). Le versioni più
  vecchie che non conoscono le opzioni dei plugin le ignorano e usano i default.
- Serve Node.js (LTS corrente) nel PATH per eseguire gli hook, anche se Claude Code
  è stato installato con l'installer nativo, che non porta Node con sé.
- Windows, macOS e Linux; la CI gira su Ubuntu e Windows.

## 8. Risoluzione dei problemi

- **Non succede nulla, o gli hook segnalano `node` non trovato.** Installa Node.js
  LTS e verifica che `node --version` funzioni nella shell da cui parte Claude Code.
- **Il guard è troppo severo.** Alza `read_max_tokens` in `/config`. Le Read con
  `limit` fino a 600 righe passano sempre.
- **Tutto succede due volte** (due policy, due rifiuti). Hai sia il setup manuale
  (§11) sia il plugin: togli gli hook manuali da `settings.json`.
- **Le novità di una release non compaiono.** Esegui
  `/plugin marketplace update token-economy`, poi
  `/plugin update token-economy@token-economy`, poi apri una nuova sessione.
- **Explore gira ancora sul modello principale.** Un altro plugin che riscrive le
  chiamate Agent (per esempio context-mode) prevale sul router. Passa
  `model: "haiku"` in modo esplicito nella chiamata Agent, oppure imposta
  `explore_model` a `inherit` e accetta il modello principale.

## 9. Strumenti complementari

Facoltativi. Senza di loro il plugin ripiega su `Grep`/`Glob` e sul filtraggio
alla fonte; con loro, ognuno toglie un tipo diverso di spreco.

| Strumento | Spreco che elimina | Fonte |
|---|---|---|
| **grepai** | Ricerca esplorativa nel tuo codice: indice semantico locale, ricerca per intento, risultato `path:riga` | [yoanbernabeu/grepai](https://github.com/yoanbernabeu/grepai) |
| **context-mode** | Output grezzo dei comandi (test, build, log): lo esegue in una sandbox e lo rende interrogabile | [mksglu/context-mode](https://github.com/mksglu/context-mode) |
| **context7** | Documentazione di librerie non aggiornata: documentazione corrente su richiesta | [upstash/context7](https://github.com/upstash/context7) |

**grepai.** Richiede [Ollama](https://ollama.com) con `nomic-embed-text` (locale)
oppure una chiave OpenAI per gli embedding.

```powershell
# Windows
irm https://raw.githubusercontent.com/yoanbernabeu/grepai/main/install.ps1 | iex
```

```bash
# macOS
brew install yoanbernabeu/tap/grepai
# Linux/macOS
curl -sSL https://raw.githubusercontent.com/yoanbernabeu/grepai/main/install.sh | sh
```

Per ogni progetto:

```bash
grepai init                                   # crea .grepai/
claude mcp add grepai -s local -- grepai mcp-serve
```

Da lì il plugin avvia `grepai watch` al posto tuo. Per condividere il server con
il team, versiona un `.mcp.json` con `{ "mcpServers": { "grepai": { "command": "grepai", "args": ["mcp-serve"] } } }`.

**context-mode.** In sessione: `/plugin marketplace add mksglu/context-mode`,
`/plugin install context-mode@context-mode`, poi verifica con `/context-mode:ctx-doctor`.
Il suo hook PreToolUse riscrive le chiamate Agent: vedi §8 per l'instradamento di Explore.

**context7.** `/plugin install context7@claude-plugins-official`, oppure come
server MCP: `claude mcp add context7 -- npx -y @upstash/context7-mcp`.

**Valutati anche, in breve:**

- [ccusage](https://github.com/ryoppippi/ccusage): consigliato, una CLI locale che
  riporta l'uso di token dai log di Claude Code; serve a misurare prima e dopo.
- [Serena](https://github.com/oraios/serena): intelligenza del codice a livello di
  simbolo, utile per repo con molti refactoring trasversali, troppi tool come default.
- Exa / Tavily MCP: solo per sessioni dominate dalla ricerca.
- MCP di memoria: esclusi, aggiungono iniezioni a ogni sessione; lo stato nei file fa lo stesso lavoro.
- Repomix: escluso, impacchetta tutto il repo nel contesto, l'approccio opposto.

## 10. Oltre il plugin

- **Igiene MCP.** Ogni server MCP connesso aggiunge le definizioni dei suoi tool a
  ogni sessione nel suo scope. Tieni lo scope `user` per ciò che usi ovunque,
  `local` o un `.mcp.json` versionato per il resto, e spegni i connettori claude.ai
  che non usi. Procedura:
  [`mcp-pruning.md`](skills/exploring-codebase/references/mcp-pruning.md).
- **Pratiche di sessione.** Una sessione per task, `/clear` tra task scollegati,
  stato nei file (un `STATUS.md` breve, piani su disco) invece che nella
  conversazione. Decidi con un modello capace, delega il lavoro meccanico e
  l'esplorazione ampia a subagent più economici. Le skill di processo come
  [superpowers](https://github.com/obra/superpowers) si integrano bene ma non sono necessarie.

## 11. Setup manuale (senza il sistema di plugin)

Hook e skill funzionano anche come semplici file; i comandi e le opzioni in
`/config` sono disponibili solo tramite il plugin.

Copia `hooks/*.mjs` (tutti e cinque: i tre hook più `limits.mjs` e `stdin.mjs`)
in `~/.claude/hooks/token-economy/`, e `skills/exploring-codebase/` in
`~/.claude/skills/exploring-codebase/`. Poi registra gli hook in
`~/.claude/settings.json`.

macOS / Linux:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Read", "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/token-economy/read-guard.mjs\"" }] },
      { "matcher": "Agent|Task", "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/token-economy/explore-router.mjs\"" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"$HOME/.claude/hooks/token-economy/session-start.mjs\"" }] }
    ]
  }
}
```

Windows: lo stesso, con path come
`"node \"C:\\Users\\<user>\\.claude\\hooks\\token-economy\\read-guard.mjs\""`.

Le opzioni diventano variabili d'ambiente nel blocco `env` di `settings.json`:
`CLAUDE_PLUGIN_OPTION_READ_MAX_TOKENS`, `CLAUDE_PLUGIN_OPTION_INJECT_POLICY`,
`CLAUDE_PLUGIN_OPTION_GREPAI_AUTOSTART`, `CLAUDE_PLUGIN_OPTION_EXPLORE_MODEL`.
Senza il plugin la telemetria dei rifiuti va in `~/.claude/token-economy/denied.jsonl`.

## 12. Disinstallazione

```
/plugin uninstall token-economy@token-economy
```

La directory dati del plugin, telemetria compresa, viene cancellata insieme al
plugin. Un daemon `grepai watch` avviato dal plugin resta attivo: fermalo con
`grepai watch --stop` nel progetto. Setup manuale: togli le voci degli hook da
`settings.json` e i file copiati.

## 13. Sviluppo

Node ESM, nessuna dipendenza, nessun build step.

```
npm test                                # tutti i test (Node 21+ per il glob dei test)
npm run bench                           # benchmark di questo repo, scrive benchmarks/results/<data>.md
node benchmarks/score.mjs --dir <path>  # benchmark di una directory qualsiasi, solo a video
```

Per provare modifiche locali: `/plugin marketplace add <path-del-clone>`,
`/plugin install token-economy@token-economy`, poi una nuova sessione; le
modifiche a hook, skill o comandi non toccano mai una sessione già in corso. Note
per chi contribuisce: [AGENTS.md](AGENTS.md). Modifiche: [CHANGELOG.md](CHANGELOG.md).
Licenza: [MIT](LICENSE).
