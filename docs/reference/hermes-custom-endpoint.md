# Hermes custom endpoint → H31d3nt0r (Cursor bridge)

Reference for [Hermes AI Providers — Custom Endpoint](https://hermes-agent.nousresearch.com/docs/integrations/providers).

Hermes treats any server implementing **OpenAI Chat Completions** as `provider: custom`. Point Hermes at this bridge; do not use legacy `OPENAI_BASE_URL` / `LLM_MODEL` env vars (removed from Hermes).

---

## Target URLs (after bridge is running)

| Purpose | URL |
|---------|-----|
| Hermes `base_url` | `http://127.0.0.1:8787/v1` |
| Chat completions | `POST http://127.0.0.1:8787/v1/chat/completions` |
| Model list | `GET http://127.0.0.1:8787/v1/models` |
| Bridge health (ops) | `GET http://127.0.0.1:8787/health` |

Use the **`/v1` suffix** in `base_url` (Hermes appends route paths relative to that base).

---

## Recommended `~/.hermes/config.yaml`

After the **H31d3nt0r** bridge checkout is installed and `BRIDGE_API_KEY` is set:

```yaml
# Primary chat model via Cursor SDK bridge
model:
  default: composer-2.5           # must match an id from GET /v1/models
  provider: custom
  base_url: http://127.0.0.1:8787/v1
  api_key: "<BRIDGE_API_KEY>"     # same value as `.env.local` next to `package.json`
  api_mode: chat_completions      # explicit; Hermes wizard sets this for custom endpoints
  context_length: 128000          # optional Hermes-side override; the bridge
                                  # only emits context_length when MODEL_CONTEXT_LENGTHS
                                  # is set in `.env.local` (repository root)

# Optional: named provider for /model custom:cursor:...
custom_providers:
  - name: cursor
    base_url: http://127.0.0.1:8787/v1
    key_env: CURSOR_BRIDGE_API_KEY
    api_mode: chat_completions
```

```bash
# ~/.hermes/.env
CURSOR_BRIDGE_API_KEY="<same BRIDGE_API_KEY>"
```

Interactive setup (equivalent):

```bash
hermes model
# → "Custom endpoint (self-hosted / VLLM / etc.)"
# → base URL: http://127.0.0.1:8787/v1
# → API key: <BRIDGE_API_KEY>
# → model: composer-2.5 (or pick from /v1/models)
# → api_mode: chat_completions
# → context_length: (optional; bridge omits unless MODEL_CONTEXT_LENGTHS is set)
```

Mid-session switch (after configured):

```
/model custom:cursor:composer-2.5
/model custom                              # auto-pick if exactly one model in /v1/models
```

---

## Verification (before `hermes chat`)

```bash
# 1. Bridge health (no auth — ops probe)
curl -s http://127.0.0.1:8787/health

# 2. Models (Hermes uses this for discovery)
curl -s -H "Authorization: Bearer $BRIDGE_API_KEY" \
  http://127.0.0.1:8787/v1/models

# 3. Chat completions smoke test (non-stream)
curl -s -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","messages":[{"role":"user","content":"Reply SDK_OK"}]}' \
  http://127.0.0.1:8787/v1/chat/completions

# 4. Streaming smoke test
curl -sN -H "Authorization: Bearer $BRIDGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"composer-2.5","stream":true,"messages":[{"role":"user","content":"Reply SDK_OK"}]}' \
  http://127.0.0.1:8787/v1/chat/completions
# → data: {...delta.content...}
# → data: [DONE]
```

---

## Auxiliary models (Hermes caveat)

Per Hermes docs, some tools (vision, web summarization, MoA) may use an **auxiliary** model when `auxiliary.*.provider` is not overridden. With only a custom endpoint configured, Hermes defaults auxiliary tasks to the **main chat model** (your bridge). Plan for that, or configure a separate cheap provider for auxiliary tasks in `config.yaml` if needed.

---

## v1 scope

**Success = `hermes chat` works** with this custom endpoint. Agent-native routes (`/v1/agents`, `/v1/runs`, …) are planned for v2 and are not required for v1.

Both surfaces (when v2 lands) use `Authorization: Bearer <BRIDGE_API_KEY>`.

---

## Related

- Operator walkthrough: [`docs/hermes-setup.md`](../hermes-setup.md)
- v2 roadmap (`/v1/agents`, durable runs, OpenAPI): GitHub Issues for this repository
