# Hermes Signal → Cursor bridge (single path)

All inference goes through the **H31d3nt0r** bridge (package name `h31d3nt0r`, systemd `hermes-cursor-api.service`) → **Cursor SDK** (local runtime). There is no secondary OpenRouter or other LLM upstream in the bridge.

## How soul, memory, and repo work

Hermes gateway still sends OpenAI `tools` in the request, but the bridge **always** runs a Cursor agent. Cursor uses its own tools (Read, Write, Shell, MCP) on:

| Need | Cursor action |
|------|----------------|
| Persona / SOUL | Write `~/.hermes/SOUL.md` |
| Durable memory | Write `~/.hermes/memories/MEMORY.md` or `USER.md` |
| Project / repo | Read/write under the repository root |
| Shell on host | Cursor terminal tools |

The bridge injects system context with these paths so the model does not claim it lacks machine access.

## Operator setup

### Bridge `.env.local` (repository root)

```bash
CURSOR_API_KEY=...
BRIDGE_API_KEY=...

# Optional overrides (defaults: repo root + ~/.hermes, project+user settings)
# HERMES_HOME=/home/ngadmin/.hermes
# WORKSPACE_CWD=/path/to/your/project
# WORKSPACE_CWD_ONLY=1          # repo only, exclude ~/.hermes from cwd list
# CURSOR_LOCAL_SETTING_SOURCES=project,user
```

Rebuild and restart:

```bash
npm run build && sudo systemctl restart hermes-cursor-api
```

### Hermes `~/.hermes/config.yaml`

Keep the custom provider pointed at the bridge:

```yaml
model:
  default: composer-2
  provider: custom
  base_url: http://127.0.0.1:8787/v1
  api_key: "<BRIDGE_API_KEY>"
  api_mode: chat_completions
```

### Verify

```bash
curl -s -H "Authorization: Bearer $BRIDGE_API_KEY" http://127.0.0.1:8787/v1/capabilities | jq .
# inference_backend: "cursor_sdk_local"
```

On Signal, ask Anton to update SOUL or save a fact — then check that `~/.hermes/SOUL.md` or `~/.hermes/memories/*.md` changed on disk.

## Limitation (explicit)

Hermes `memory_*` **tool_calls** are not returned by the bridge. Persistence is **file-based** via Cursor edits under `~/.hermes/`. The next Hermes session loads memory from those files at startup.

See [hermes-custom-endpoint.md](hermes-custom-endpoint.md) and [docs/hermes-setup.md](../hermes-setup.md).
