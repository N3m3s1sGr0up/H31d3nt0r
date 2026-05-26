# AGENTS.md — H31d3nt0r (Hermes ↔ Cursor bridge)

Contract for **agents calling this bridge** and **agents modifying this service**. The bridge is a primitives API; there is no GUI fallback.

## For agents calling the bridge

### Primitives (v1 / v1.1)

| You want | Use |
|----------|-----|
| Liveness probe | `GET /health` (no auth) — exposes `bridgeGeneration`, `changelog`, `version` (no Cursor I/O here) |
| Readiness probe | `GET /ready` (no auth) — `Cursor.models.list` within `BRIDGE_CURSOR_READY_MS` unless that env is `0` (skipped) |
| Discover models | `GET /v1/models` plus `GET /v1/models/{id}` (Bearer) |
| Chat with Cursor (one turn) | `POST /v1/chat/completions` non-stream (Bearer) |
| Chat with streaming output | `POST /v1/chat/completions` with `"stream": true` (Bearer; SSE + `[DONE]`). Mid-run heartbeats via `: …` SSE comments when `BRIDGE_SSE_HEARTBEAT_MS > 0`. Mid-stream fatalities yield one `data:` line `{ "object": "bridge.error", "error": { "code", "message", "error_id", "retryable" } }` before `[DONE]`. Successful streams may append a synthetic `usage` stanza when `stream_options.include_usage=true` (zeroed on Cursor). |
| Discover bridge modes | `GET /v1/capabilities` (Bearer) |
| **OpenAI tools / Hermes loop** | **Dual path:** (A) Configure `BRIDGE_CHAT_UPSTREAM_*` (`tools` or `always`) to POST verbatim to OpenAI-compat `/v1/chat/completions` for native `tool_calls`. (B) Fallback: Cursor system injection + optional `HERMES_BRIDGE_TOOL_JSON` tail parse (`src/openai/tool-bridge.ts`). |
| Soul / memory on Signal | Cursor Write to `~/.hermes/SOUL.md` and `~/.hermes/memories/*.md` (injected bridge context) |

### Agent-native rules

1. **No business workflows.** This bridge exposes OpenAI primitives only. Compose higher-level behavior in your own code or prompts; do not expect or request endpoints like `/v1/summarize` or `/v1/review_pr` — they will not be added.
2. **Auth is symmetric.** All clients (Hermes, curl, scripts) use the same `Authorization: Bearer <BRIDGE_API_KEY>` header. No per-user or per-tenant scoping in v1.
3. **Errors are structured.** Failures on `/v1/*` plus **`GET /ready`** yield JSON bodies whose `error` includes `code`, `message`, `error_id`, `type`, `param`, optional `retryable`, and optional `request_id` (when request-id middleware ran — always inside `buildApp`). `type` mirrors OpenAI-style categories (`authentication_error`, `invalid_request_error`, etc.) so generic OpenAI clients can classify failures alongside bridge `code`. Parse `code` (plus `retryable` when supplied); correlate logs via `request_id` (matches outbound `X-Request-Id` — inbound header must stay ASCII-safe ≤128 chars). Streaming fatalities still emit SSE `{"object":"bridge.error", ...}` chunks before `[DONE]` with the same nesting. Cursor SDK diagnostics never echo raw secrets to HTTP/SSE bodies.
4. **Completion / termination is explicit.** Non-stream finals are HTTP **`200`** + `chat.completion`, or **`504`** with **`request_timeout`** / **`sdk_connect_timeout`** when timers fire (**usually `retryable: true`** for Hermes). Streams always terminate with **`[DONE]`**; classify mid-stream outages via SSE `bridge.error.error.code`.
5. **Bridge generation (v2).** Once `/v1/context` lands, treat `bridgeGeneration` as a restart marker — IDs minted before that bump may return `410 Gone`.

### Deferred primitives (v2)

`/v1/agents`, `/v1/agents/:id/runs`, SSE run control for durable runs, `/v1/context`, OpenAPI docs — still deferred; discovery endpoints (`GET /v1/capabilities`, `GET /v1/models/:id`) already ship against this codebase. Until agents/runs/context land, durable session state lives in your Hermes-side client.

## For agents modifying this service

### Patterns

- **One-shot vs durable.** Chat completions usually map to `Agent.prompt(...)`, unless `chatUpstream` routes through OpenAI-compat HTTPS (native `tool_calls`). Do **not** smuggle Cursor `Agent.create` state across requests in v1. **Tool fallback:** non-upstream loads inject tool defs plus optional `HERMES_BRIDGE_TOOL_JSON` parsing — Hermes executes tools locally on follow-up turns.
- **Dual error classes.** `CursorAgentError` → 502 (startup; auth/config/network). `result.status === "error"` → 500 (run failed). `cancelled` → 200 with `{ status: "cancelled" }`. Always dispose agents per the [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript) lifecycle patterns (`await using`, `Symbol.asyncDispose`, or `finally`).
- **Dispose always.** Every `Agent.create` / `Agent.resume` site needs a `finally { await agent[Symbol.asyncDispose]() }` or `await using`. `Agent.prompt` disposes for itself.
- **Local runtime, explicit cwd.** Always pass `local: { cwd, settingSources }` from bridge config. Defaults to `settingSources: []`; operators may set `CURSOR_LOCAL_SETTING_SOURCES` (comma list) when Cursor must load ambient project/user settings or MCP registrations from disk. Never pass `cloud: {}` from this bridge.
- **Optional MCP on runs.** Pass `CURSOR_AGENT_MCP_SERVERS` (JSON object) when runs need explicit SDK `mcpServers` beside whatever `settingSources` discover.
- **Secrets stay server-side.** `CURSOR_API_KEY` is read from env at request time; never echoed in JSON, headers, or logs. Tests must assert this.
- **Loopback binding.** `HOST` defaults to `127.0.0.1`. Do not change without an explicit security ticket.

### Conventions

- TypeScript strict + `noUncheckedIndexedAccess`. Avoid `any`. Prefer `unknown` + narrowing.
- Inline imports are forbidden; imports stay at the top of each file (workspace rule).
- Vitest. Tests live in `test/`. Integration tests gated by `RUN_CURSOR_INTEGRATION=1`.
- No comments that narrate code. Comments explain *why*, never *what*.
- No dependency added without justification; the surface is intentionally small.

### Verification ladder

| Layer | How |
|-------|-----|
| Types | `npm run typecheck` |
| Unit | `npm test` (mocks `@cursor/sdk`) |
| SDK round-trip | `npm run verify-sdk` (needs `CURSOR_API_KEY`) |
| HTTP shape | `curl` examples in [`docs/reference/hermes-custom-endpoint.md`](docs/reference/hermes-custom-endpoint.md) |
| End-to-end (ship gate) | `hermes chat` against this bridge |

### Out-of-scope changes

Do not add in v1 without re-running planning:

- Cloud Cursor agents (`cloud: { repos }`).
- LAN exposure, TLS, reverse proxy.
- GitHub operations (`gh`, clone, PR, issues) for the bridge itself.
- Persistent session store, idempotency, agent caps — all deferred to v2 in U4.
- MCP server registration into Cursor runs — deferred to v2 (Pattern A).
