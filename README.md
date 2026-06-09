<p align="center">
  <img src="H31d3nt0r.png" alt="H31d3nt0r logo" width="400" />
</p>

# H31d3nt0r

**h31d3nt0r** — "Heathens' Gate" — is a local gateway for connecting any AI-capable tool or client to modern AI models using your own Cursor subscription. Inspired by the open, inviting notion of a gate for all comers, h31d3nt0r lets any application that speaks the [OpenAI Chat Completions API wire format](https://platform.openai.com/docs/api-reference/chat) (e.g. `/v1/models`, `/v1/chat/completions`) access the power of models you run via Cursor.

Its `/v1/*` routes are fully OpenAI-compatible at the protocol level, acting as a drop-in endpoint for any tool — from terminals to IDEs to creative automation — that can send standard OpenAI JSON with Bearer authentication. While it comes wired for [`@cursor/sdk`](https://cursor.com/docs/sdk/typescript), the architecture is purposefully stack-agnostic: the only requirement is a valid Cursor subscription powering the backend. The result: a universal "heathens' gate" that enables cursor subscription for any OpenAI-compatible client, via your own compute and your own API key.

Bindings default to **127.0.0.1** only.

## Layout

```
H31d3nt0r/                         # clone root (= npm package root)
├── package.json
├── tsconfig.json / tsconfig.build.json
├── .env.local.example         → copy → .env.local (chmod 600)
├── agent-workspace/           sample cwd for npm run verify-sdk
├── systemd/h31d3nt0r.service      templated systemd unit
├── docs/
│   ├── operator-setup.md      install + systemd + curl
│   └── reference/openai-extensions.md   OPENAI_COMPAT_TOOL_JSON + upstream proxy notes
├── src/
│   ├── index.ts               HTTP server entry
│   ├── config.ts              env parsing
│   ├── routes/health.ts       GET /health
│   ├── routes/ready.ts       GET /ready
│   ├── routes/openai/        /v1/chat/completions, /v1/models, /v1/capabilities
│   ├── cursor/                SDK façade + injected system preamble
│   └── openai/                request normalization, SSE mapping, tool bridge
├── test/
└── AGENTS.md                  implementer checklist
```

## Endpoints

| Route | Auth | Notes |
|-------|------|-------|
| `GET /health` | none | `ok`, `service` (`h31d3nt0r`), `version`, `changelog`, uptime. |
| `GET /ready` | none | Readiness probe; honors `BRIDGE_CURSOR_READY_MS`. |
| `GET /v1/capabilities` | Bearer | Bridge metadata, workspaces, timeouts, upstream mode |
| `GET /v1/models` | Bearer | Backed by `Cursor.models.list()`. Optional `MODEL_CONTEXT_LENGTHS` enrichment. |
| `GET /v1/models/:id` | Bearer | Same pool; accepts optional `cursor/` prefix. |
| `POST /v1/chat/completions` | Bearer | Stream + JSON responses; SSE heartbeats `: bridge-heartbeat …` when configured. Terminal `[DONE]`; fatal SSE chunk `{ "object":"bridge.error", … }`. |

### Tool calling

- **`BRIDGE_CHAT_UPSTREAM_*`**: optionally forward chat to another OpenAI-compatible upstream for canonical `tool_calls` (advanced; default path is Cursor SDK local). `tools` mode only proxies conversations that include a non-empty `tools` array; `always` proxies every qualifying request.
- **Cursor-direct path**: optional **`OPENAI_COMPAT_TOOL_JSON …`** finale line documented in **`docs/reference/openai-extensions.md`**.

## Environment

See **`.env.local.example`** — required keys **`CURSOR_API_KEY`**, **`BRIDGE_API_KEY`**.

Highlights:

| Variable | Meaning |
|---------|---------|
| `WORKSPACE_CWD` | Primary Cursor workspace (defaults to this repo/install root beside `package.json`). |
| `BRIDGE_EXTRA_CWD` | Optional second workspace directory (SDK cwd becomes `[WORKSPACE_CWD, BRIDGE_EXTRA_CWD]`). |
| `WORKSPACE_CWD_ONLY` | When `1`: single-root mode (ignores `BRIDGE_EXTRA_CWD`). |
| `CURSOR_LOCAL_SETTING_SOURCES` | Comma-separated Cursor setting layers (default parses to `project,user` when unset in env file — see `.env.local.example`). |
| `MODEL_CONTEXT_LENGTHS` | `id:tokens,id2:tokens` table for `/v1/models` `context_length`. |
| `BRIDGE_CHAT_UPSTREAM_*` | Optional HTTPS OpenAI-compat forwarder (`off`/`tools`/`always`). |

## Quickstart

```bash
cd /path/to/H31d3nt0r
npm install --include=dev   # hosts that omit devDependencies need this explicitly
cp .env.local.example .env.local && chmod 600 .env.local
# fill CURSOR_API_KEY + BRIDGE_API_KEY
set -a; source .env.local; set +a
npm run verify-sdk && npm run typecheck && npm test
# Live Cursor probe (optional): npm run test:integration
npm run dev                 # http://127.0.0.1:8787
```

Detailed production/systemd instructions: **`docs/operator-setup.md`**.

### Client sketch

Point any OpenAI-compatible client at **`http://127.0.0.1:8787/v1`**. Many clients label the key field `OPENAI_API_KEY` (OpenAI-compat convention); the value must be your **`BRIDGE_API_KEY`** from `.env.local` — not a Cursor platform key (`CURSOR_API_KEY`) and not an OpenAI platform key. Send **`Authorization: Bearer <BRIDGE_API_KEY>`** on `/v1/*`. Discover model IDs from `GET /v1/models` (for example `composer-2.5`). With the gateway running, **`npm run verify-client`** probes `/health` and `/v1/models`. See **`docs/operator-setup.md`** §6 for the full checklist.

### Graceful shutdown

`SIGTERM`/`SIGINT` drains the HTTP listener; SSE streams cancel active Cursor runs where supported. systemd `TimeoutStopSec` should exceed the app's internal watchdog by a few seconds (template uses 35 s vs 30 s internal fallback).

### Security reminders

Loopback-only by default, `.env.local` never committed (`CURSOR_API_KEY` stays server-side), Bearer auth on `/v1/*`.

## Contributing / references

- [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript)
- [AGENTS.md](AGENTS.md) — conventions for callers + maintainers.
