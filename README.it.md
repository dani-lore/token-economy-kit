# token-economy

> 🇬🇧 English version: [README.md](README.md)

Plugin Claude Code per sessioni token-efficienti. Pacchetto autonomo: questo README contiene tutto quello che serve per capire, installare e adottare il sistema — incluse le policy da aggiungere al proprio `CLAUDE.md` globale e l'installazione degli strumenti consigliati.

---

## 1. Il problema

Nelle sessioni Claude Code una quota rilevante dei token di input viene spesa in **letture esplorative**: il modello apre file interi (anche molto lunghi) per "capire dove sta la cosa", quando una ricerca mirata avrebbe restituito il punto esatto in poche righe. Conseguenze: costo, ma soprattutto degrado — un contesto gonfio peggiora l'attenzione del modello e anticipa la compaction (riassunto con perdita di informazioni).

Due fatti guidano il design di questo kit:

1. **Le istruzioni testuali sono advisory.** Una regola in `CLAUDE.md` ("non leggere file interi") viene rispettata quasi sempre a inizio sessione e dimenticata sotto pressione o in sessioni lunghe. Nessuna riga di prompt può *impedire* una Read.
2. **Solo gli hook sono enforcement.** Un hook `PreToolUse` viene eseguito dall'harness (non dal modello) prima di ogni chiamata tool, e può negarla in modo deterministico.

Il principio operativo è: **localizza, non leggere**. La ricerca (semantica o pattern) trova il punto; la Read è chirurgica (`offset`/`limit`) e serve solo per agire (Edit, verifica puntuale). Leggere non è vietato — è vietato leggere *alla cieca*.

## 2. I 4 componenti del plugin

| Componente | File | Livello | Cosa fa |
|---|---|---|---|
| **read-guard** | `hooks/read-guard.mjs` | Enforcement | Hook PreToolUse: nega le Read senza `offset`/`limit` su file di testo > 600 righe o > 256 KB, e i dump shell di file interi (`cat`/`type`/`Get-Content`/`gc`) della stessa dimensione, che altrimenti aggirerebbero il guard. Le letture con pipe/redirect o già limitate (`cat f \| grep`, `Get-Content f -TotalCount 50`) passano. Il messaggio di rifiuto indica le 3 alternative (ricerca, Read mirata, subagent scout). Fail-open: qualsiasi errore interno dell'hook lascia passare la chiamata, non blocca mai il lavoro per un proprio bug. |
| **inject-policy** | `hooks/inject-policy.mjs` | Policy | Hook SessionStart: inietta 5 righe di policy nel contesto di ogni sessione. Chi installa il plugin non deve toccare il proprio `CLAUDE.md` (ma può, vedi §5). |
| **exploring-codebase** | `skills/exploring-codebase/SKILL.md` | Protocollo | Skill caricata on demand: decision tree completo (quale strumento per quale domanda), template di dispatch per scout, esempi di query semantiche efficaci, casi in cui la Read diretta È la scelta giusta. Il dettaglio sta nella skill proprio per non pesare sul contesto fisso. |
| **scout** | `agents/scout.md` | Delega | Subagent su modello **Haiku** (~20-30× più economico dei modelli top): esegue ricognizioni ampie (3+ file, panoramiche architetturali) nel *proprio* contesto e riporta solo conclusioni con riferimenti `path:line`, max ~40 righe, mai dump di file. Le letture che fa muoiono con lui. |

**Comandi** (slash command, su richiesta):

- `/context-audit` — esegue il benchmark di input-bloat sul repo corrente e
  riporta quanto risparmia il guard *qui* (rapporto di riduzione, file oltre soglia, peggiori casi).
- `/economy-stats` — riporta il risparmio realmente registrato dal guard al momento del deny
  (`.claude/token-economy/denied.jsonl`), a differenza del limite massimo statico di `/context-audit`.
- `/economy-help` — riferimento rapido: principio, componenti, ordine delle operazioni, comandi.

### Perché questa architettura (presupposti delle scelte)

- **Policy breve + skill di dettaglio**: una policy lunga nel contesto fisso viene rispettata meno ed è essa stessa spreco. Le 5 righe iniettate rimandano alla skill, che si carica solo quando serve esplorare.
- **Subagent per l'esplorazione**: quando un subagent esplora, i file letti e gli output grezzi restano nel suo contesto isolato; alla sessione principale torna solo la sintesi. È il modo più robusto per non sporcare il contesto, ed è nativo (nessuna dipendenza esterna).
- **Soglie 600 righe / 256 KB**: abbastanza alte da non intralciare il lavoro normale (config, componenti medi passano), abbastanza basse da intercettare i file che fanno male al contesto. Modificabili in testa a `read-guard.mjs` (`MAX_LINES`, `MAX_BYTES`).
- **Fail-open**: un guardrail che per un bug blocca il lavoro fa più danni dello spreco che previene.

## 3. Prerequisiti

- **Claude Code** v1.0.33+ (`claude --version`; aggiorna con `npm update -g @anthropic-ai/claude-code`)
- **Node.js** 18+ sul PATH (esegue gli hook `.mjs`)
- **Consigliati, non inclusi**: grepai, context-mode, context7 — vedi §6. Il kit funziona anche senza (il guardrail e scout usano `Grep`/`Glob` come fallback), ma il grosso del risparmio in *localizzazione* viene dalla ricerca semantica.

**Partire da zero è supportato.** Tutto ciò che non è incluso nel kit è opzionale e il sistema degrada in modo esplicito: senza grepai, scout e la skill ripiegano su `Grep`/`Glob`; senza context-mode, la policy chiede di filtrare l'output alla fonte (`head`, `grep`, flag `--quiet`); senza context7, docs via WebFetch sulla pagina ufficiale. Nessun componente fallisce per uno strumento mancante (i tool MCP non presenti semplicemente non compaiono). Adozione incrementale consigliata: prima il plugin da solo, poi grepai (il singolo upgrade più redditizio), poi il resto.

## 4. Installazione del plugin

I comandi `/plugin` si eseguono **dentro una sessione Claude Code** (slash command), non dal terminale.

Da repo GitHub:

```
/plugin marketplace add dani-lore/token-economy-kit
/plugin install token-economy@token-economy
/reload-plugins
```

Da path locale (test o uso privato):

```
/plugin marketplace add C:\path\to\token-economy-kit
/plugin install token-economy@token-economy
```

**Effetti visibili dopo l'installazione** (nuova sessione):

- a inizio sessione compare il blocco "Token Economy policy (plugin)";
- una Read integrale di un file lungo viene rifiutata con un messaggio che propone le alternative; una Read con `offset`/`limit` passa normalmente;
- l'agent `scout` è disponibile nel tool Agent e la skill `exploring-codebase` nella lista skill.

### Setup manuale (senza sistema plugin)

Copia i file in `~/.claude/`:

```
~/.claude/hooks/read-guard.mjs
~/.claude/hooks/inject-policy.mjs        (facoltativo se metti la policy in CLAUDE.md, §5)
~/.claude/skills/exploring-codebase/SKILL.md
~/.claude/skills/exploring-codebase/references/mcp-pruning.md
~/.claude/agents/scout.md
```

Poi registra gli hook in `~/.claude/settings.json` (adatta i path; su macOS/Linux `~/.claude/...`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Bash|PowerShell",
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\<user>\\.claude\\hooks\\read-guard.mjs\"" }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:\\Users\\<user>\\.claude\\hooks\\inject-policy.mjs\"" }
        ]
      }
    ]
  }
}
```

## 5. Policy per il CLAUDE.md globale (consigliato)

Il plugin inietta già la policy a ogni SessionStart. Se preferisci averla stabilmente nel tuo `~/.claude/CLAUDE.md` (vale anche senza plugin, ed è più visibile/personalizzabile), aggiungi questa sezione — è la versione di riferimento:

```markdown
## Token Economy (MANDATORY)

**Locate, don't read.** Mandatory order:
1. **Locating code** → `grepai_search` / `grepai_trace_*` (if indexed), else `Grep`/`Glob`. Never exploratory Read.
2. **Read** only to act (Edit / targeted verification) and only narrow: `offset`/`limit` on the section you need. Full Read of files >600 lines: forbidden (hook blocks it).
3. **Broad exploration** (architecture, "where is X", 3+ files) → `scout` subagent (Haiku): returns conclusions, not dumps.
4. **Command output >20 lines** → context-mode (`ctx_batch_execute`) if installed, else filter at the source (head, grep, targeted flags); **library docs** → context7 if installed, else WebFetch the official docs page.
5. Detailed protocol: skill `exploring-codebase`.
```

Facoltativa ma coerente col sistema, sempre nel CLAUDE.md globale:

```markdown
### Subagent strategy
- Offload research, exploration, and parallel analysis to subagents (one task per subagent).
- Use the cheapest model that can do the job: Haiku for search/recon, Sonnet for mechanical plan execution, top model for decisions and non-trivial code.
```

> Se usi il plugin [superpowers](https://github.com/anthropics/claude-plugins) (o skill di processo equivalenti come `brainstorming` / `writing-plans`), puoi aggiungere anche una riga che le richiama esplicitamente per i task non triviali. **Non è un prerequisito**: questo kit non dipende da superpowers né da altre skill di processo.

Se usi sia il plugin sia il CLAUDE.md, la policy compare due volte (innocuo, ~80 token). Per evitarlo: rimuovi l'hook SessionStart dal tuo `settings.json`, non aggiungere la sezione al CLAUDE.md, oppure imposta la variabile d'ambiente `TOKEN_ECONOMY_INJECT=0` per far uscire l'hook senza stampare nulla.

## 6. Strumenti consigliati: cosa fanno e come installarli

Tre strumenti complementari, ciascuno elimina una categoria diversa di spreco. Comandi verificati sulle fonti ufficiali (giugno 2026).

| Strumento | Categoria di spreco eliminata | Fonte |
|---|---|---|
| **grepai** | Read/Grep esplorative sul *tuo codice*: indice semantico locale, cerchi per intento ("dove viene persistito lo stato del toggle"), ottieni `path:line` | github.com/yoanbernabeu/grepai |
| **context-mode** | Output grezzi di *comandi* (test, build, log, JSON): esegue in sandbox, indicizza, tu interroghi l'indice invece di ricevere 500 righe in contesto | github.com/mksglu/context-mode |
| **context7** | Documentazione *librerie esterne* datata: docs aggiornate on demand, evita cicli prova-errore su API cambiate e WebSearch | github.com/upstash/context7 |

### grepai (ricerca semantica codebase)

Prerequisito: [Ollama](https://ollama.com) con modello `nomic-embed-text` (default, tutto locale), oppure una OpenAI API key per gli embedding.

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

Per ogni progetto, prima indicizzazione e registrazione MCP:

```bash
cd <progetto>
grepai init          # crea .grepai/ e configura
grepai watch         # indicizza e mantiene aggiornato l'indice
claude mcp add grepai -s local -- grepai mcp-serve
```

In alternativa, per condividerlo col team, committa un `.mcp.json` nella root del progetto:

```json
{
  "mcpServers": {
    "grepai": { "command": "grepai", "args": ["mcp-serve"] }
  }
}
```

Nota: l'indice invecchia — dopo refactor grossi verifica con `grepai_index_status` e reindicizza prima di fidarti dei risultati.

### context-mode (output comandi fuori dal contesto)

Dentro una sessione Claude Code:

```
/plugin marketplace add mksglu/context-mode
/plugin install context-mode@context-mode
/reload-plugins
```

Verifica con `/context-mode:ctx-doctor` (tutti i check `[x]`). Hook e tool MCP (`ctx_batch_execute`, `ctx_search`, `ctx_execute`...) si registrano da soli.

### context7 (docs librerie aggiornate)

Il marketplace ufficiale è già registrato in Claude Code:

```
/plugin install context7@claude-plugins-official
```

In alternativa come MCP server diretto: `claude mcp add context7 -- npx -y @upstash/context7-mcp`. API key gratuita (rate limit più alti) su context7.com/dashboard.

### Complementi valutati (giugno 2026) — e cosa abbiamo escluso deliberatamente

Il panorama è stato esaminato prima di fermarsi alla triade. Verdetti, così non devi ripetere la valutazione:

- **[ccusage](https://github.com/ryoppippi/ccusage)** — *consigliato, costo zero.* CLI locale (non MCP: non aggiunge nulla al contesto) che legge i log JSONL di Claude Code e riporta il consumo token per giorno/sessione/progetto. Usalo per misurare la baseline prima e dopo l'adozione del kit: `npx ccusage`.
- **[Serena](https://github.com/oraios/serena)** — *opzionale, per-repo.* Code intelligence LSP-based (find-references a livello simbolo, rename cross-file). Genuinamente complementare a grepai (ricerca semantica per intento vs grafo esatto dei simboli), ma inietta ~15 tool definition per sessione. Vale nei repo con refactoring cross-file pesante; eccessivo come default.
- **Exa / Tavily MCP** — *opzionale, solo per chi fa molta ricerca web.* Risultati condensati invece di fetch di pagine intere. Aggiunge un MCP + API key; per il lavoro di coding la ricerca web è una categoria di spreco minore. Skip salvo sessioni dominate dalla ricerca.
- **MCP di memoria (claude-mem, mem0, basic-memory)** — *esclusi.* Riducono la ri-derivazione di contesto ma aggiungono iniezioni per sessione e latenza di retrieval — esattamente il costo fisso che questo kit combatte. Lo stato-nei-file (§8) copre lo stesso bisogno gratis.
- **Repomix** — *escluso.* Impacchetta l'intero repo nel contesto per analisi one-shot: la filosofia opposta del retrieve-on-demand. Utile per audit esterni una tantum, regresso netto come workflow di sessione.

Le feature native di Claude Code (deferred tool schema, auto-compaction) continuano a migliorare e riducono il costo fisso degli MCP installati — ma non sostituiscono nessun elemento della triade.

## 7. Igiene MCP e contesto fisso (il risparmio che non si vede)

Spesso lo spreco maggiore non sono le Read: è il **contesto fisso** caricato a ogni sessione.

- **Server MCP a scope `user`** caricano i loro tool in *ogni* repo. Regola: scope `user` solo per ciò che usi ovunque; scope `local` (per-progetto, privato) per il resto; `.mcp.json` committato per ciò che serve a tutto il team. Procedura completa, con comandi `claude mcp add/remove/list`, in [`skills/exploring-codebase/references/mcp-pruning.md`](skills/exploring-codebase/references/mcp-pruning.md).
- **Plugin con molte skill** (es. raccolte di esempi): ogni skill aggiunge la sua descrizione al contesto di ogni sessione. Disattiva globalmente quelli non quotidiani (`/plugin`), riattivali per-repo dove servono (`.claude/settings.local.json` → `enabledPlugins`).
- **Connettori claude.ai** (Gmail, Drive, viaggi, ecc.): si gestiscono da claude.ai → Settings → Connectors, non da CLI. Disattiva quelli che non usi per lavoro.
- **Hook SessionStart**: ogni iniezione automatica ha un costo per sessione. Tieni quelle ad alto valore (es. uno STATUS.md di ~10 righe del progetto), elimina il resto.

Il contesto corto non è solo più economico: degrada meno l'attenzione del modello e ritarda la compaction. È un beneficio di *qualità*, prima che di costo.

## 8. Oltre il plugin: pratiche di sessione

Il plugin copre lo spreco *strumentale* (letture, output, docs, contesto fisso). Le due leve restanti sono comportamentali — nessun hook può farle al posto tuo, e insieme valgono quanto tutto il resto:

**Igiene di sessione.** Il costo di una sessione cresce più che linearmente con la sua lunghezza: ogni scambio ritrasmette tutta la storia precedente. Quindi: una sessione = un task; `/clear` tra task non correlati; stato persistente nei *file*, non nella conversazione (uno `STATUS.md` di ~10 righe con fase corrente e piano attivo, piani con checkbox in `plans/*.md`, decisioni in ADR). Se lo stato vive nei file, ogni sessione può partire corta e fredda senza perdere nulla — ed è anche il prerequisito per delegare a subagent.

**Orchestrazione dei modelli.** Non tutti i passaggi meritano lo stesso modello: pianifica e decidi col modello capace, esegui il meccanico con uno economico. In pratica: subagent Haiku per ricerca/ricognizione (scout), subagent Sonnet per task di piano ben specificati, modello top in sessione principale per architettura, review e codice non triviale. Anche il contrario funziona: sessione quotidiana su Sonnet e `/model` per salire solo quando serve.

**Quando fermarsi.** Questo kit + le due pratiche sopra sono la baseline ad alto rendimento. Oltre (cache-tuning manuale, compressione aggressiva dell'output, micro-gestione di ogni tool call) il rendimento crolla: ore di configurazione per punti percentuali, e regole troppo rigide iniziano a costare in *qualità* delle risposte. Se il guardrail ti intralcia più di una volta al giorno, alza le soglie invece di aggiungere eccezioni.

## 9. Disattivazione / rollback

```
/plugin uninstall token-economy
```

Setup manuale: rimuovi le voci `hooks` da `settings.json` e cancella i file copiati. Tutto il kit è additivo: nessuna modifica distruttiva da annullare.

Per ritarare le soglie del guardrail senza disinstallare: modifica `MAX_LINES` / `MAX_BYTES` in `hooks/read-guard.mjs`.
