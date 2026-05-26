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
npm start
```

By default the gateway listens on `http://127.0.0.1:8787`.

## 4. Quick HTTP checks

```bash
curl -s http://127.0.0.1:8787/health | jq .

curl -s http://127.0.0.1:8787/v1/models \
  -H "Authorization: Bearer $BRIDGE_API_KEY" | jq .
```

## 5. systemd (optional)

From the clone root:

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

## 6. Client configuration (generic)

Point any OpenAI-compatible client at:

- **Base URL:** `http://127.0.0.1:8787/v1` (must include `/v1` suffix when the client appends `/chat/completions` or `/models`.)
- **API key:** the same value as `BRIDGE_API_KEY`.

Model identifiers are passed through to Cursor (optional `cursor/` or `cursor:` prefixes are stripped internally).
