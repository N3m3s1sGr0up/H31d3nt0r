# Operator setup

End-to-end: install dependencies, configure secrets, run the gateway, optionally install systemd.

## 1. Prerequisites

- Node.js **≥ 20** on the host PATH (`/usr/bin/node` is typical for systemd).
- A **Cursor API key** (`CURSOR_API_KEY`) — keep server-side only.
- A randomly generated **bearer secret** (`BRIDGE_API_KEY`) that HTTP clients send as `Authorization: Bearer …` on `/v1/*`.

## 2. Install and configure

```bash
cd /path/to/H31d3nt0r
npm install --include=dev    # omit --include=dev only if devDependencies already install locally
cp .env.local.example .env.local
$EDITOR .env.local           # CURSOR_API_KEY + BRIDGE_API_KEY
chmod 600 .env.local
```

Smoke-test the Cursor SDK:

```bash
set -a; source .env.local; set +a
npm run verify-sdk           # exits 0 and prints SDK_OK when healthy
```

## 3. Run the server

Development (tsx watch):

```bash
npm run dev
```

Production bundle:

```bash
npm run build
./start.sh          # or: npm start
./start.sh status   # PID + /health
./start.sh stop     # SIGTERM listener on configured port
```

By default the gateway listens on `http://127.0.0.1:8787`.

**Remote bind warning:** `HOST` defaults to loopback. Binding to `0.0.0.0` or another non-loopback address requires `BRIDGE_ALLOW_REMOTE_BIND=1` and must be paired with TLS termination and network ACLs — the gateway is not hardened for wide-area exposure by itself.

**`BRIDGE_API_KEY` rotation:** generate a new secret (`openssl rand -hex 32`), update every client, restart the gateway, then remove the old key from client configs. There is no per-client revocation in v1 — rotation is all-or-nothing.

**Upstream proxy:** when `BRIDGE_CHAT_UPSTREAM_MODE` is not `off`, `BRIDGE_CHAT_UPSTREAM_URL` must be `https://`. Optionally set `BRIDGE_CHAT_UPSTREAM_HOST_ALLOWLIST` to a comma-separated hostname list so only trusted upstreams are permitted.

## 4. Quick HTTP checks

```bash
curl -s http://127.0.0.1:8787/health | jq .

curl -s http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer $BRIDGE_API_KEY" | jq .
```

## 5. Autostart

### macOS (LaunchAgent)

Install login autostart (survives reboot; Node loads `.env.local` via `loadConfig()`):

```bash
npm run build
./start.sh install-autoboot
./start.sh status
```

Remove autostart:

```bash
./start.sh uninstall-autoboot
```

- **Stop until next login:** `./start.sh stop` (boots out the launchd job; plist remains for next login).
- **Start after stop:** `./start.sh start` (re-bootstraps launchd when the plist is installed).
- **Logs:** `logs/launchd.stdout.log` and `logs/launchd.stderr.log` under the clone root.

### Linux (systemd user service — recommended)

`./start.sh install-autoboot` renders `systemd/h31d3nt0r.user.service` to
`~/.config/systemd/user/h31d3nt0r.service`, enables + starts it, and turns on
**linger** so it runs without an active login session (survives logout and
reboot). No `sudo` required.

```bash
npm run build
./start.sh install-autoboot
./start.sh status                       # PID + /health
systemctl --user status h31d3nt0r       # unit state
journalctl --user -u h31d3nt0r -n 30 -o cat
```

- **Stop until next boot:** `./start.sh stop` (the unit stays enabled).
- **Start again:** `./start.sh start` (delegates to `systemctl --user start`).
- **Remove autoboot:** `./start.sh uninstall-autoboot` (disables + removes the
  unit; linger is left on — disable with `loginctl disable-linger "$(id -un)"`).
- **Logs:** `journalctl --user -u h31d3nt0r` (the unit logs to the journal).

After code or dependency updates: `npm run build && systemctl --user restart h31d3nt0r`.

> If `loginctl enable-linger` fails (some hardened/headless setups), run it once
> with elevation: `sudo loginctl enable-linger "$(id -un)"`.

### Linux (system-wide systemd — advanced, multi-operator/hardened)

For a hardened or shared host, install a root-managed unit from the
system-wide template instead. This runs as a fixed `User=` regardless of login
state and is the right choice when several operators share the box:

```bash
INSTALL_ROOT="$(pwd)"
SERVICE_USER="$(id -un)"
sudo sed \
  -e "s|__INSTALL_ROOT__|${INSTALL_ROOT}|g" \
  -e "s|__SERVICE_USER__|${SERVICE_USER}|g" \
  systemd/h31d3nt0r.service \
| sudo tee /etc/systemd/system/h31d3nt0r.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now h31d3nt0r.service
systemctl is-active h31d3nt0r
journalctl -u h31d3nt0r -n 30 -o cat
```

After code or dependency updates: `npm run build && sudo systemctl restart h31d3nt0r`.

> Use **either** the user service **or** the system-wide unit — not both. Two
> units bound to the same `PORT` will collide with `EADDRINUSE`.

## 6. Client integration

**Workspace OPSEC:** The default `WORKSPACE_CWD` is this repository. That is fine for gateway development — it is **not** an engagement directory. Pentest/red-team artifacts (Kerberos `.ccache`, BloodHound exports, loot, hashes) must live under `~/ops/<engagement>/` with `WORKSPACE_CWD` pointed there for those sessions.

**What this endpoint is:** **h31d3nt0r** is a local Cursor SDK-backed gateway on loopback. Clients use an **OpenAI-compatible wire format** (not OpenAI cloud inference) on `/v1/*`. Optional `BRIDGE_CHAT_UPSTREAM_*` forwarding is advanced and off by default.

**Client integration checklist** (tool-agnostic — Open WebUI, Continue, custom automation, etc.):

1. **Gateway running** — `npm run dev`, `npm start`, or systemd (§3–5).
2. **Base URL** — `http://127.0.0.1:8787/v1` (include `/v1` when the client appends `/chat/completions` or `/models`).
3. **API key** — `BRIDGE_API_KEY` from `.env.local` (not `CURSOR_API_KEY`, not an OpenAI platform key). Many clients name the field `OPENAI_API_KEY`; use your bridge secret as the value.
4. **Model ID** — from `GET /v1/models` (e.g. `composer-2.5` when listed). Optional `cursor/` or `cursor:` prefixes are stripped internally.

**Verify:** run `npm run verify-client` (or the §4 curl checks) before pointing a client at the gateway.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|--------|--------------|-----|
| Connection refused / Connection error (OpenAI-compatible client, curl) | Gateway not running | `./start.sh status` then `./start.sh` |
| 401 Unauthorized on `/v1/*` | Wrong API key | Use `BRIDGE_API_KEY` from `.env.local`, not `CURSOR_API_KEY` or an OpenAI platform key |
| Client URL errors / 404 on chat | Base URL missing `/v1` | Set base URL to `http://127.0.0.1:8787/v1` (or `suggested_base_url` from `GET /v1/capabilities`) |
| `EADDRINUSE` / "address already in use" on start | Another process (often h31d3nt0r) already listening on `PORT` | `./start.sh status`; `./start.sh stop`. With autoboot installed (§5), launchd (macOS) or the systemd user service (Linux, `Restart=on-failure`) may respawn until `./start.sh stop` or `./start.sh uninstall-autoboot`. Never run the user service and the system-wide unit together |
| Invalid model / model not found | Client model ID not in Cursor catalog | `GET /v1/models` for canonical IDs; built-in alias `composer2-5` → `composer-2.5`. Upstream/Cursor errors may also mean account or model access |
| `GET /ready` returns 503 | Cursor cloud readiness probe failed | Unlike `/health` (liveness only). Check `CURSOR_API_KEY`, network, `BRIDGE_CURSOR_READY_MS`; set `BRIDGE_CURSOR_READY_MS=0` to skip probe if only `/health` is needed |
| `GET /ready` returns 429 | Ready probe rate limit | Default `BRIDGE_READY_RATE_LIMIT_PER_MIN=30`; raise or set `0` to disable if your orchestrator legitimately polls faster |
| Client "Connection error" with retries | Client polling before gateway is ready | Run `npm run verify-client` first; confirm autoboot finished (`./start.sh status`); base URL includes `/v1`; client not pointed at wrong `PORT` |
| `502 agent_startup_failed` / `Cannot find package '@connectrpc/connect-node'` | `@cursor/sdk` imports `@connectrpc/connect-node` but does not declare it as a dependency, so npm never installs it | We pin `@connectrpc/connect-node` directly in `dependencies` (version-matched to `@connectrpc/connect`). If this recurs after an SDK bump, run `npm ls @connectrpc/connect` and `npm install @connectrpc/connect-node@^<that version>`, then `systemctl --user restart h31d3nt0r` (Linux) / `./start.sh stop && ./start.sh` |

**Quick diagnose:** `npm run verify-client` prints checklist hints and fails fast when the port is closed.

**Model typos:** clients may send `composer2-5`; the gateway normalizes that to `composer-2.5` internally. Canonical IDs still come from `GET /v1/models`.

## 8. Debug request logging

Set `BRIDGE_DEBUG_REQUESTS=1` in `.env.local` (or export before `npm run dev`) to log one JSON line per `/v1/*` request on stderr:

```json
{"type":"bridge.request","request_id":"req_…","method":"POST","path":"/v1/chat/completions","status":200,"duration_ms":42,"model":"composer-2"}
```

Logs include route, status, duration, and model when present. They never include `Authorization`, message bodies, or `CURSOR_API_KEY`.

## 9. Integration tests

Offline by default:

```bash
npm test
```

Live Cursor probe (requires `.env.local` with `CURSOR_API_KEY` and `BRIDGE_API_KEY`):

```bash
npm run test:integration
```

Run `npm run version:verify` before tagging if you changed version fields manually.

## 10. Releases

```bash
npm run version:bump -- <semver> "<note>"
npm run version:verify && npm run typecheck && npm test
git add package.json package-lock.json src/bridge-metadata.ts
git commit -m "chore: release v<semver>"
git tag v<semver>
git push origin main --tags
```

The bump script refuses semver downgrades and duplicate tags already on `origin`.
