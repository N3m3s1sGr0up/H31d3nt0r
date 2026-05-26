# Hermes ↔ H31d3nt0r bridge — operator walkthrough

End-to-end guide from a working bridge to `hermes chat` returning Cursor output. Pairs with [`reference/hermes-custom-endpoint.md`](reference/hermes-custom-endpoint.md) and the [Hermes providers guide](https://hermes-agent.nousresearch.com/docs/integrations/providers).

This is the **v1 ship gate**: when `hermes chat` produces a Cursor response, the bridge is done.

---

## Step 0 — Bridge is healthy

Confirm the bridge is up and the SDK round-trip works before touching Hermes:

```bash
systemctl is-active hermes-cursor-api          # → active
curl -s http://127.0.0.1:8787/health           # → {"ok":true,"changelog":[...],"version":"...", ...}
curl -s http://127.0.0.1:8787/ready            # readiness: Cursor.models.list (see BRIDGE_CURSOR_READY_MS in README)
curl -s -H "Authorization: Bearer $BRIDGE_API_KEY" \
  http://127.0.0.1:8787/v1/models | jq .data[].id
# → default, composer-2.5, composer-2, claude-sonnet-4-6, ...
```

If `/health` is up but `/v1/models` returns `agent_startup_failed`, fix the bridge's `CURSOR_API_KEY` first — see [README.md → Security notes](../README.md#security-notes).

After you change bridge **source code**, rebuild and restart (systemd serves `dist/`, not `src/`):

```bash
npm run build && sudo systemctl restart hermes-cursor-api
```

See [README.md → Operations (systemd)](../README.md#operations-systemd).

---

## Step 1 — Install Hermes

Refer to the [Hermes install docs](https://hermes-agent.nousresearch.com/docs). Bridge work does not depend on a specific Hermes install location; the bridge speaks OpenAI Chat Completions over loopback.

> Hermes Agent install is **out of v1 scope** for the bridge itself (R25). This guide assumes Hermes is already on the host.

---

## Step 2 — Configure `~/.hermes/config.yaml`

Reference layout (see also [reference/hermes-custom-endpoint.md](reference/hermes-custom-endpoint.md) for the canonical version):

```yaml
model:
  default: composer-2.5                 # pick from /v1/models output
  provider: custom
  base_url: http://127.0.0.1:8787/v1
  api_key: "<paste BRIDGE_API_KEY>"     # mirror `.env.local` in the bridge checkout (repo root)
  api_mode: chat_completions

# Optional: named custom provider, lets you switch via `/model custom:cursor:...`
custom_providers:
  - name: cursor
    base_url: http://127.0.0.1:8787/v1
    key_env: CURSOR_BRIDGE_API_KEY
    api_mode: chat_completions
```

And in `~/.hermes/.env`:

```bash
CURSOR_BRIDGE_API_KEY="<same BRIDGE_API_KEY>"
```

Equivalent interactive setup:

```bash
hermes model
# → Custom endpoint (self-hosted / VLLM / etc.)
# → base URL:   http://127.0.0.1:8787/v1
# → API key:    <BRIDGE_API_KEY>
# → api_mode:   chat_completions
# → model:      composer-2.5 (or whatever /v1/models lists)
# → context_length: (skip; bridge supplies via MODEL_CONTEXT_LENGTHS if set)
```

Verify Hermes can see the bridge:

```bash
hermes model show
# Expect: provider=custom, base_url=http://127.0.0.1:8787/v1
```

---

## Step 3 — Pre-flight (curl)

Before `hermes chat`, prove the bridge accepts Hermes-shaped requests:

```bash
curl -sS -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","messages":[{"role":"user","content":"Reply SDK_OK"}]}' \
  http://127.0.0.1:8787/v1/chat/completions | jq .
# → { "object": "chat.completion", "choices":[ ... "content":"SDK_OK" ... ] }
```

Optional: `-H "X-Request-Id: <opaque id>"` for curl debugging — the bridge echoes the same header and includes `request_id` in JSON error payloads when Hermes/tooling forwards it.

Streaming smoke test:

```bash
curl -sN -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","stream":true,"messages":[{"role":"user","content":"Reply SDK_OK"}]}' \
  http://127.0.0.1:8787/v1/chat/completions
# → data: { ... "delta": { "content": "SDK_OK" } ... }
# → data: [DONE]
```

---

## Step 4 — `hermes chat` (the ship gate)

```bash
hermes chat
# → talk to Cursor through the bridge; verify a response comes back.
```

If `hermes chat` succeeds, **v1 is shipped**. Everything below is auxiliary.

---

## Hermes browser tools: Brave (CDP attach)

Hermes attaches to any **Chromium-family** browser speaking CDP (`/browser connect` or persistent `browser.cdp_url`). **Brave is already included** alongside Chrome/Chromium/Edge in auto-discovery (DEB/RPM installs, Flatpak exports under `/var/lib/flatpak/exports/bin/` and `~/.local/share/flatpak/exports/bin/`).

When several browsers are installed, Hermes prefers **Chrome first**, then Chromium, then Brave, unless you pin the launcher:

```bash
# Force which binary Hermes tries first for auto-launch (systemd/user shell or ~/.hermes/.env):
export HERMES_BROWSER_CDP_EXECUTABLE="/usr/bin/brave-browser-stable"
```

Manual Brave with a dedicated Hermes debug profile:

```bash
brave-browser --remote-debugging-port=9222 --user-data-dir="$HOME/.hermes/chrome-debug" --no-first-run --no-default-browser-check
```

Then `hermes` → `/browser connect` (or leave `browser.cdp_url` / `BROWSER_CDP_URL` pointing at `http://127.0.0.1:9222`).

---

## Auxiliary-model caveat

Per Hermes docs, certain tools (vision summarization, MoA, web fetch helpers) default the auxiliary model to your main provider when `auxiliary.*.provider` is unset. With only the bridge configured, Hermes will route auxiliary tasks to the bridge → Cursor. That works, but may be more expensive or slower than a dedicated auxiliary provider. If this matters, point `auxiliary.*` at a cheaper provider in `config.yaml`.

---

## Signal: soul, memory, and repo

By default, chat traffic rides **Cursor SDK** through this bridge. You can alternatively enable **`BRIDGE_CHAT_UPSTREAM_*`** so Hermes gets **native OpenAI `tool_calls`** (see README + new section below). Whenever Cursor runs remain active, Hermes attaches `tools` on gateway turns; the Cursor runtime still sees **repo root** + **`~/.hermes`** (SOUL, memories, config).

- Persona → Cursor edits `~/.hermes/SOUL.md`
- Memory → Cursor edits `~/.hermes/memories/MEMORY.md` / `USER.md`
- Repo → Cursor tools on the project tree

Walkthrough: [reference/hermes-signal-dual-runtime.md](reference/hermes-signal-dual-runtime.md).

```bash
curl -s -H "Authorization: Bearer $BRIDGE_API_KEY" http://127.0.0.1:8787/v1/capabilities | jq .
```

---

## Tool calling (OpenAI `tools` → Hermes round-trip, v1.1)

The bridge **accepts** OpenAI `tools` and **`tool_choice`** on `POST /v1/chat/completions`.

### Path A — OpenAI-compatible upstream proxy (Hermes-parity defaults)

- Set `BRIDGE_CHAT_UPSTREAM_URL` (full `https://…/v1/chat/completions`).
- Provide `BRIDGE_CHAT_UPSTREAM_API_KEY` **or** `OPENAI_API_KEY` for the Bearer token.
- `BRIDGE_CHAT_UPSTREAM_MODE`: `tools` forwards only conversations that ship a non-empty `tools` array (ideal for Hermes tool loops — Cursor never sees those turns). `always` forwards every `/v1/chat/completions` upstream (Hermes/custom model identifiers must resolve there).
- Streams and statuses pass through verbatim; bridge semaphore slots still enforce `MAX_AGENTS`.

### Path B — Cursor injection + synthetic `tool_calls` (fallback)

- **Injection:** Non-empty `tools` are merged into the Cursor system prompt as JSON (the Cursor SDK has no separate “register these OpenAI functions” API).
- **Return path:** The model can ask Hermes to run a client-registered tool by appending a final line to its reply:

  `HERMES_BRIDGE_TOOL_JSON {"tool_calls":[{"id":"…","type":"function","function":{"name":"<registered name>","arguments":"<JSON string>"}}]}`

  The bridge strips that suffix from `message.content`, validates `name` against the request’s tool list, and returns OpenAI-shaped **`message.tool_calls`** with **`finish_reason: "tool_calls"`** (non-stream) or the same in SSE before `[DONE]` (stream requests with `tools` buffer the Cursor stream until the run completes, then emit scrubbed content + tool deltas).

- **Cursor-native tools** (built-in file/terminal/MCP inside Cursor) still execute inside the Cursor agent and are **not** the same as Hermes `tool_calls`; SDK stream `tool_use` blocks remain the agent’s internal detail. Use **`CURSOR_LOCAL_SETTING_SOURCES`** / **`CURSOR_AGENT_MCP_SERVERS`** when Cursor must discover MCP from disk. Defaults: see [README Environment](../README.md#environment).

For legacy behaviour with **no** `tools` in the request, responses are plain assistant text only (v1).

---

## Credential map

| Place | Field | Value |
|-------|-------|-------|
| Bridge `.env.local` (repository root) | `CURSOR_API_KEY` | Cursor platform key (SDK auth) |
| Bridge `.env.local` (repository root) | `BRIDGE_API_KEY` | Bridge bearer (shared with Hermes) |
| Bridge `.env.local` (repository root) | `BRIDGE_CHAT_UPSTREAM_*` | Optional OpenAI-compat forwarder secrets (upstream URL/API key/timeouts — see README) |
| `~/.hermes/config.yaml` | `model.api_key` | Same value as `BRIDGE_API_KEY` |
| `~/.hermes/.env` | `CURSOR_BRIDGE_API_KEY` | Same value (if using `custom_providers` form) |

The two `*_API_KEY` values are **distinct on purpose** — `BRIDGE_API_KEY` is what Hermes sends; the bridge never forwards it to Cursor. The bridge uses `CURSOR_API_KEY` server-side only and never echoes it (verified in tests).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `hermes chat` 401 from bridge | Hermes `api_key` ≠ `BRIDGE_API_KEY` | Re-sync the value in `~/.hermes/config.yaml` |
| `agent_startup_failed` 502 from `/v1/models` | Bridge's `CURSOR_API_KEY` is bad or expired | Rotate in `.env.local`, `sudo systemctl restart hermes-cursor-api` |
| `bad_request` 400 with "unknown model" | Hermes `model.default` not in `/v1/models` | `curl /v1/models`; pick a real id |
| `stream_unsupported` 422 | Cursor SDK didn't expose a stream for that run | Set `stream: false` (or unset) in Hermes |
| Empty `data:` events / no `[DONE]` | Proxy/HTTP intermediary buffering SSE | Hit the bridge directly (loopback only in v1) |
| Service won't start | `EnvironmentFile=` missing or wrong perms on `.env.local` | `ls -la .env.local` from the repository root (must be `0600`; fix owner if needed) |
| 502 on `/v1/chat/completions` after a long pause | Cursor cloud expired or rate-limited | `journalctl -u hermes-cursor-api -n 50 -o cat`; retry per `retryable` flag |
| Bridge returns `upstream_fetch_failed`/`upstream_timeout` | Upstream unreachable, TLS issues, abort budget | Probe `BRIDGE_CHAT_UPSTREAM_URL`; confirm API key/quota/log egress; widen `BRIDGE_CHAT_UPSTREAM_MS` |
| Memory never updates / soul unchanged | Cursor did not write files | Ask explicitly to edit `~/.hermes/SOUL.md` or `memories/*.md`; check bridge `workspace_cwd` includes `~/.hermes` via `/v1/capabilities` |
| “Can't work on this computer” | Old bridge or missing context | Rebuild/restart bridge; ensure `inference_backend` matches how you routed traffic (`cursor_sdk_local` vs `openai_compatible_upstream`) |
| Cursor won't touch files or run commands | SDK run not loading Cursor MCP / rules from disk | Try `CURSOR_LOCAL_SETTING_SOURCES=project,user` (and ensure `WORKSPACE_CWD` is the tree you expect) |

Logs:

```bash
journalctl -u hermes-cursor-api -f -o cat
```

---

## Out of scope for v1

- `/v1/agents`, `/v1/agents/:id/runs`, durable SSE — v2 roadmap; follow this repository’s Issues.
- Hermes Pattern A (MCP into Cursor runs).
- LAN exposure, TLS, reverse proxy.

When v2 lands, this guide will gain a section on `/v1/agents` and the MCP wiring.
