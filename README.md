# H31d3nt0r

Loopback HTTP bridge around `@cursor/sdk` so [Hermes Agent](https://hermes-agent.nousresearch.com/docs) (`provider: custom`) — and any other local automation — can drive Cursor agents over an OpenAI-compatible API. No GUI; HTTP is the agent surface. (This repository is published as **H31d3nt0r**; systemd and health payloads still use the `hermes-cursor-api` service name.)

> **v1 success** = operator runs `hermes chat` against this bridge and gets one successful turn. Agent-native CRUD routes (`/v1/agents`, `/v1/runs`, `/v1/capabilities`, OpenAPI) are **v2** — track design in this repository’s Issues.

## Layout

```
H31d3nt0r/                         # clone root (= npm package root)
├── package.json
├── tsconfig.json / tsconfig.build.json
├── .env.local.example         (copy → .env.local, chmod 600)
├── hermes-workspace/          shared cwd for Cursor SDK local runs
├── src/
│   ├── index.ts               server entry (U3)
│   ├── config.ts              env loading (U2)
│   ├── bridge-metadata.ts     package version + changelog (health/capabilities)
│   ├── with-timeout.ts       Promise timeouts for chat + probes
│   ├── request-id.ts       X-Request-Id middleware + derivation
│   ├── hono-env.d.ts       ContextVariableMap (`requestId`)
│   ├── auth.ts                Bearer middleware (U3)
│   ├── errors.ts              JSON error envelope (U3)
│   ├── cursor/client.ts       thin SDK wrapper (U2)
│   ├── routes/
│   │   ├── health.ts          GET /health (U3)
│   │   ├── ready.ts           GET /ready readiness probe (Cursor models.list)
│   │   └── openai/
│   │       ├── chat-completions.ts   POST /v1/chat/completions (U8)
│   │       ├── capabilities.ts      GET /v1/capabilities (Bearer)
│   │       └── models.ts             GET /v1/models (U8)
│   ├── openai/
│   │   ├── map-stream.ts      SDK stream → OpenAI SSE + optional synthetic usage parity (U8)
│   │   ├── tool-bridge.ts     Inject `tools`, parse `HERMES_BRIDGE_TOOL_JSON`
│   │   ├── chat-normalize.ts Validated OpenAI payloads (developer/multimodal/tools)
│   │   ├── upstream-proxy.ts  Optional OpenAI-compat forwarder for Hermes-native tool_calls
│   │   └── types.ts           OpenAI request/response shapes (U8)
│   └── scripts/verify-sdk.ts  SDK smoke test (U1)
├── test/                      vitest
├── docs/hermes-setup.md       operator walkthrough (U6)
├── systemd/hermes-cursor-api.service   service unit (U5)
└── AGENTS.md                  contract for implementers + callers
```

## v1 endpoints

**v1.1** adds OpenAI-compatible **`tool_calls` return path** when the request includes non-empty `tools`: definitions are injected into the Cursor system prompt, and the model can end its reply with `HERMES_BRIDGE_TOOL_JSON {"tool_calls":[...]}` so Hermes receives normal OpenAI `tool_calls` (see [docs/hermes-setup.md](docs/hermes-setup.md#tool-calling-openai-tools--hermes-round-trip-v11)).

**Upstream parity.** Configure `BRIDGE_CHAT_UPSTREAM_*` so Hermes can hit whichever OpenAI-compat origin you picked: `BRIDGE_CHAT_UPSTREAM_MODE=tools` forwards requests **only while `tools[]` is non-empty**, giving native Hermes-compatible `tool_calls` without Cursor prompt tricks; `always` proxies every turn upstream (Hermes/custom model identifiers must resolve on that upstream).

| Route | Auth | What it does |
|-------|------|--------------|
| `GET /health` | none | `ok`, `service`, `version`, monotonic `bridgeGeneration`, uptime, `changelog` bullets (Hermes/operators anchor for generation bumps). |
| `GET /ready` | none | Readiness probe: runs `Cursor.models.list` unless `BRIDGE_CURSOR_READY_MS=0` — returns structured errors when Cursor/API is unreachable. |
| `GET /v1/capabilities` | Bearer | Bridge discovery: workspaces, timeouts, SSE + upstream knobs, release metadata. |
| `GET /v1/models` | Bearer | OpenAI list shape over `Cursor.models.list()`, with `context_length` when configured. |
| `GET /v1/models/:id` | Bearer | OpenAI single-model retrieve (accepts optional `cursor/` prefix on the ids). |
| `POST /v1/chat/completions` | Bearer | OpenAI chat completions; `stream: true` emits SSE (`: comment` heartbeats when `BRIDGE_SSE_HEARTBEAT_MS > 0`). Terminal is always `[DONE]`. Fatal mid-stream faults emit `data: {"object":"bridge.error",...}` with machine `error.code`, then `[DONE]` (Hermes parses `retryable` there alongside HTTP errors). |

### Request tracing

Send `X-Request-Id` on any request (`A-Z a-z 0-9` plus `._:-`, length ≤128). The bridge echoes the same header on the response (`req_*` minted when the header is absent or malformed). JSON error bodies (`/v1/*`, `GET /ready`, 404/not_found) append `error.request_id`. Streaming fatal envelopes may include nested `request_id`. stderr JSON lines keyed `request_id` line up when `internalDetails` logging fires.

This repository does not ship mandatory git hooks; add your own CI or pre-commit tooling as needed.

## SSE `bridge.error` codes (streaming)

Hermes/other clients treat these like HTTP `error.code`:

- `stream_wall_clock_timeout` — `BRIDGE_CHAT_STREAM_MS` exceeded; Cursor run cancelled; `retryable: true`.
- `stream_client_disconnect` — subscriber dropped; `retryable: true`.
- `stream_upstream_failure` — iterator/SDK failure mid-stream before normal completion.

## Environment

Copy `.env.local.example` → `.env.local`, fill in values, and `chmod 600 .env.local`.

| Var | Purpose |
|-----|---------|
| `CURSOR_API_KEY` | Cursor platform key the SDK authenticates with. **Never returned to clients.** |
| `BRIDGE_API_KEY` | Bearer secret clients send to `/v1/*`. Generate: `openssl rand -hex 32`. |
| `HOST` | Bind address. Default `127.0.0.1`. |
| `PORT` | Bind port. Default `8787`. |
| `WORKSPACE_CWD` | Primary tree the Cursor SDK treats as the local workspace. When unset, defaults to **this repository’s root** (the directory that contains `package.json`). Override when the bridge lives inside a monorepo and agents should target the outer application tree instead. See also `WORKSPACE_CWD_ONLY`. |
| `CURSOR_LOCAL_SETTING_SOURCES` | Comma list of Cursor setting layers for SDK local agents: `project`, `user`, `team`, `mdm`, `plugins`, `all`. Default empty (no ambient layers). Set e.g. `project,user` when runs should pick up on-disk Cursor MCP and rules. |
| `CURSOR_AGENT_MCP_SERVERS` | Optional JSON object: `AgentOptions.mcpServers` merged into every `Agent.create` / `Agent.prompt`. Lets you register stdio/HTTP MCP servers (e.g. Hermes MCP) for Cursor runs without v2 HTTP wiring. |
| `MAX_AGENTS` | Cursor SDK concurrency semaphore; saturated calls get `429` + `retry-after`. |
| `BRIDGE_CHAT_COMPLETION_MS` | Non-stream chat wall clock (504 `request_timeout` when breached). Default `900000`; `0` disables. |
| `BRIDGE_CHAT_STREAM_MS` | Streaming wall clock (`stream_wall_clock_timeout` SSE envelope + cancel). Default `900000`; `0` disables. |
| `BRIDGE_SDK_STREAM_CONNECT_MS` | Agent.create/send budget before SSE starts (504 `sdk_connect_timeout`). Default `120000`; `0` disables. |
| `BRIDGE_CURSOR_READY_MS` | `GET /ready` awaits `models.list`; `0` skips probe (`readiness.cursor_sdk="skipped"`). Default `12000`. |
| `BRIDGE_SSE_HEARTBEAT_MS` | Periodic SSE `: comment` pings (`0` disables). Default `15000`. |
| `SDK_VERIFY_MODEL` | Optional override for `npm run verify-sdk` (default `composer-2`). |
| `BRIDGE_CHAT_UPSTREAM_MODE` | `off` (default): Cursor only. `tools`: forward tool-enabled chats to upstream. `always`: every chat proxies upstream (requires Hermes/custom model IDs that upstream understands). |
| `BRIDGE_CHAT_UPSTREAM_URL` | Absolute URL to upstream `/v1/chat/completions` — required whenever mode ≠ `off`. |
| `BRIDGE_CHAT_UPSTREAM_API_KEY` / `OPENAI_API_KEY` | Bearer token forwarded as `Authorization: Bearer …` (`BRIDGE_CHAT_UPSTREAM_API_KEY` wins if both set). |
| `BRIDGE_CHAT_UPSTREAM_MS` | Upstream POST budget (abort → `upstream_timeout`; default `120000`). |

## Quickstart

```bash
cd /path/to/H31d3nt0r   # clone root

# 1. Install (requires Node >= 20 + npm on PATH; systemd ExecStart wants /usr/bin/node)
#    If TypeScript/vitest are missing after install, your npm may omit devDependencies globally — run:
#    npm install --include=dev
npm install

# 2. Configure secrets
cp .env.local.example .env.local
$EDITOR .env.local                # set CURSOR_API_KEY + BRIDGE_API_KEY
chmod 600 .env.local

# 3. Prove the SDK works (Phase 1 ship gate)
set -a; source .env.local; set +a
npm run verify-sdk                # → prints SDK_OK and exits 0

# 4. Run the bridge in dev (U3+ onwards)
npm run dev                       # listens on http://127.0.0.1:8787

# 5. Type-check + tests
npm run typecheck
npm test
```

## Production install

Run these once on the host from your clone directory.

```bash
# 0. Install system Node 20 + npm (the systemd unit uses /usr/bin/node, NOT
#    the Cursor-bundled node). Ubuntu's default `apt install nodejs` may ship
#    Node 18 — use NodeSource for >= 20:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs npm
node --version    # >= 20.x
which node        # /usr/bin/node

# 1. Build the production bundle and prove the SDK works.
cd /path/to/H31d3nt0r                  # your clone (repository root)
npm install
npm run build
set -a; source .env.local; set +a
npm run verify-sdk     # → prints SDK_OK

# 2. Install the systemd unit (template contains __INSTALL_ROOT__ and __SERVICE_USER__).
INSTALL_ROOT="$(pwd)"
SERVICE_USER="$(id -un)"
sudo sed \
  -e "s|__INSTALL_ROOT__|${INSTALL_ROOT}|g" \
  -e "s|__SERVICE_USER__|${SERVICE_USER}|g" \
  systemd/hermes-cursor-api.service \
| sudo tee /etc/systemd/system/hermes-cursor-api.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now hermes-cursor-api.service

# 3. Verify the bridge is up.
systemctl is-active hermes-cursor-api      # → active
curl -s http://127.0.0.1:8787/health        # → { ok: true, ... }
journalctl -u hermes-cursor-api -n 20 -o cat

# 4. Wire Hermes — see docs/hermes-setup.md and
#    docs/reference/hermes-custom-endpoint.md.
```

## Operations (systemd)

Once `hermes-cursor-api.service` is enabled, use systemd for process management (not manual `nohup`).

| Task | Command |
|------|---------|
| Status | `systemctl status hermes-cursor-api` |
| Live logs | `journalctl -u hermes-cursor-api -f` |
| Restart (e.g. after `.env.local` edit) | `sudo systemctl restart hermes-cursor-api` |
| Stop | `sudo systemctl stop hermes-cursor-api` |

### Elevated commands (sudo) from Cursor / Hermes tool runs

The bridge process is systemd-managed child processes inherit its security sandbox. Older units set `NoNewPrivileges=true` and `RestrictSUIDSGID=true`, which block `sudo` and other setuid helpers with “no new privileges” style errors. The template in `systemd/hermes-cursor-api.service` now omits those two lines so local SDK runs can escalate when needed (see comments in that file — tighten again for hardened hosts).

After updating the unit on disk: `sudo systemctl daemon-reload && sudo systemctl restart hermes-cursor-api`.

Separate issue: Cursor’s **agent Shell** integration may impose its own no-new-privileges layer. If sudo still fails from Composer after the unit fix, run the privileged command from a normal host terminal (SSH, Kitty, GNOME Terminal) — that bypasses Cursor’s agent sandbox regardless of systemd.

### After code changes

The unit runs the compiled bundle at `dist/index.js`. Rebuild TypeScript, then restart so systemd picks up the new `dist/` (run from your clone root):

```bash
npm run build && sudo systemctl restart hermes-cursor-api
```

When `package.json` dependencies changed, run `npm install` before `npm run build`. After pulling from git:

```bash
npm install && npm run build && sudo systemctl restart hermes-cursor-api
```

References:

- [`systemd/hermes-cursor-api.service`](systemd/hermes-cursor-api.service) — service unit (U5)
- [`docs/hermes-setup.md`](docs/hermes-setup.md) — operator walkthrough (U6)
- [`docs/reference/hermes-custom-endpoint.md`](docs/reference/hermes-custom-endpoint.md) — Hermes `config.yaml` reference

### Graceful shutdown

The server installs `SIGTERM` / `SIGINT` handlers that call `server.close()` to drain in-flight chat streams. A 30 s internal hard ceiling guarantees the process exits even if a client connection is stuck; the systemd unit's `TimeoutStopSec=35s` gives a 5 s buffer on top. For `stream: true` clients, `out.onAbort()` cancels the underlying Cursor run (when `run.supports("cancel")`) before disposing the agent.

## Security notes

- `127.0.0.1` only. No LAN or public exposure in v1.
- `Authorization: Bearer <BRIDGE_API_KEY>` enforced on every `/v1/*` route (constant-time compare).
- `/health` is unauthenticated for ops probes and reveals only non-sensitive build info.
- `.env.local` is the only place `CURSOR_API_KEY` lives; it is never echoed in responses or logs.
- `.env.local` is gitignored. This repository’s [`.gitignore`](.gitignore) lists secrets and build artifacts.

## See also

- [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript)
- [Hermes providers — custom endpoint](https://hermes-agent.nousresearch.com/docs/integrations/providers)
- [AGENTS.md](AGENTS.md) — implementer + caller contract

## Publish to a private GitHub repository

From this directory (after [installing `gh`](https://cli.github.com/) and `gh auth login`):

```bash
git add -A
git status                                         # confirm .env.local / node_modules / dist are absent
git commit -m "Initial import: H31d3nt0r"
git branch -M main
gh repo create YOUR_ORG/H31d3nt0r --private --source=. --remote=origin --push
```

Use `git init` first only if this directory is not yet a Git repository. Replace `YOUR_ORG/H31d3nt0r` with your GitHub namespace and desired repo name. Omit `--push` if you prefer to inspect the remote first.
