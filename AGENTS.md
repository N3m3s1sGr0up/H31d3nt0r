# AGENTS.md — H31d3nt0r

Contract for **agents calling this gateway** (OpenAI-compatible HTTP) and **agents modifying its source**.

## For agents calling the gateway

### Primitives

| Goal | Endpoint |
|------|----------|
| Liveness probe | `GET /health` (no auth) — exposes `bridgeGeneration`, `changelog`, `version`. |
| Readiness probe | `GET /ready` (no auth) — probes `Cursor.models.list` unless `BRIDGE_CURSOR_READY_MS=0` (skipped). |
| Models | `GET /v1/models`, `GET /v1/models/{id}` with Bearer auth. |
| Chat (blocking) | `POST /v1/chat/completions` with Bearer auth. |
| Chat (streaming) | Same POST with `"stream": true` — SSE, terminal `[DONE]`. `: comment` heartbeats when `BRIDGE_SSE_HEARTBEAT_MS > 0`. |
| Capability discovery | `GET /v1/capabilities` (Bearer). |

### Dual tool path (v1.1)

- **Upstream proxy:** `BRIDGE_CHAT_UPSTREAM_*` POSTs verbatim to OpenAI-compatible `/v1/chat/completions` for native structured `tool_calls`.
- **Cursor path:** Inject tool definitions into prompts; optionally parse **`OPENAI_COMPAT_TOOL_JSON`** on assistant text (`src/openai/tool-bridge.ts`). See **`docs/reference/openai-extensions.md`**.

### Gateway rules

1. **Composable surface only.** Implement higher-level workflows in your own tooling; `/v1/*` stays primitives-shaped.
2. **Shared bearer.** `Authorization: Bearer <BRIDGE_API_KEY>` guards `/v1/*`. No tenancy in v1.
3. **Structured errors.** JSON bodies expose `error.code`, nested OpenAI-ish `type`/`param`, `retryable`, `request_id` when present.
4. **Streams terminate with `[DONE]`.** Mid-stream failures prepend an SSE `{ "object": "bridge.error", ... }` chunk with `retryable` where applicable.

## For agents modifying this service

### Patterns

- **One-shot runs.** Prefer `Agent.prompt(...)` mapped from chat completions unless upstream routing is configured.
- **Dispose agents.** Wrap `Agent.create` / streaming handles with async disposal (`await using` / `finally`).
- **`local.cwd` wiring.** Resolved from env via `workspaceCwd` config; MCP via `CURSOR_AGENT_MCP_SERVERS` optional JSON.
- **Secrets never echoed.** Assertions and logging must omit `CURSOR_API_KEY`/bridge secrets.

### Conventions

- TypeScript strict; no `inline` imports policy per repo.
- Vitest suites under `test/`.

### Verification

| Scope | Command |
|-------|---------|
| Types | `npm run typecheck` |
| Unit | `npm test` |
| Live SDK ping | `npm run verify-sdk` (requires `CURSOR_API_KEY`) |
| Operational flow | **`docs/operator-setup.md`** |
