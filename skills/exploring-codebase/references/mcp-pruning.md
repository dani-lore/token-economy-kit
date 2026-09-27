# MCP pruning

Every connected MCP server adds its tool definitions to the session, whether or
not you use them. Keep each server in the narrowest scope that still covers the
repos that need it.

## 1. Diagnose

- `/context` inside a session: how much of the context window MCP tools take.
- `claude mcp list` in a terminal: every configured server and its status.

A server in the `user` scope loads in every repo you open.

## 2. Scopes

| Scope | Where it loads | Use it for |
|---|---|---|
| `local` (default) | This repo, only for you | A server one repo needs, private config |
| `project` | This repo, for everyone (`.mcp.json`, committed) | A server the whole team needs |
| `user` | Every repo you open | A server you really use everywhere |

## 3. Commands

```bash
# Add a server for this repo only
claude mcp add <name> -s local -- <command> [args]

# Share it with the team (writes .mcp.json)
claude mcp add <name> -s project -- <command> [args]

# Remove a server from the user scope
claude mcp remove <name> -s user

# Inspect a server
claude mcp get <name>
```

## 4. Project `.mcp.json` for grepai

With `grepai` on the PATH, in the root of a repo initialized with grepai:

```json
{
  "mcpServers": {
    "grepai": {
      "command": "grepai",
      "args": ["mcp-serve"]
    }
  }
}
```

Commit it so the team gets the same server. Claude Code asks each user to
approve project-scoped servers the first time.

## 5. claude.ai connectors

Connectors enabled on your claude.ai account are account-level and not managed
by the CLI. Turn off the ones you do not use for coding in
**claude.ai → Settings → Connectors**.
