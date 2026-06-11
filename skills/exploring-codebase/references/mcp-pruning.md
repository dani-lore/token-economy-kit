# MCP Pruning — Procedura di manutenzione

## 1. Diagnosi

```
claude mcp list
```

Ogni server con scope **user** carica i suoi tool in OGNI repo aperto con Claude Code.
Tool inutilizzati consumano contesto e aumentano il rumore nei deferred tool.

---

## 2. Regola degli scope

| Scope | Quando usarlo |
|-------|---------------|
| `user` | Server utili in qualsiasi repo (es. grepai, context7) |
| `local` | Server per un repo specifico, privato (non committato) |
| `project` | Server che tutto il team deve avere — va in `.mcp.json` committato |

---

## 3. Comandi CLI

```bash
# Aggiungere un server per-repo (privato)
claude mcp add <name> -s local -- <command> [args]

# Rimuovere un server dallo scope user
claude mcp remove <name> -s user

# Ispezionare un server
claude mcp get <name>
```

---

## 4. Re-add documentati

Server rimossi dallo scope `user` il 2026-06-11. Riattivali per-repo dove servono:

**Obsidian**
```bash
claude mcp add obsidian -s local -- npx "@mauricio.wolff/mcp-obsidian@latest" "<path-vault>"
```

**NotebookLM**
```bash
claude mcp add notebooklm-mcp -s local -- notebooklm-mcp
```

**GitHub MCP** (alternativa: usare `gh` CLI)
```bash
claude mcp add github -s local -- npx -y @modelcontextprotocol/server-github
# Richiede GITHUB_PERSONAL_ACCESS_TOKEN nell'ambiente
```

---

## 5. Template `.mcp.json` di progetto (grepai)

Adattare `<user>` e `<project-root>` al repo corrente:

```json
{
  "mcpServers": {
    "grepai": {
      "command": "C:\\Users\\<user>\\Documents\\Tools\\grepai\\bin\\grepai",
      "args": ["mcp-serve", "<project-root>"]
    }
  }
}
```

Committare `.mcp.json` nella root del repo. Aggiungere a `.gitignore` solo se contiene path privati.

---

## 6. Connettori claude.ai

Gmail, Booking, Expedia, Kiwi, Tripadvisor, Malwarebytes, ecc. operano a livello account,
non gestibili da CLI.

Gestione: **claude.ai → Settings → Connectors** — disattivare quelli non usati per lavoro.
