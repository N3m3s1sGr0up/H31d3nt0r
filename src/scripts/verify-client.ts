/**
 * HTTP client smoke test for integrators (Heremes-style OpenAI-compatible clients).
 *
 * Pass criteria:
 *   - Exit 0 and stdout contains the literal token `CLIENT_OK`.
 * Failure classes:
 *   - Exit 1: gateway not reachable or env missing.
 *   - Exit 2: health or authenticated /v1/models probe failed.
 */

import { loadConfig } from "../config.js";

function printChecklistHints(host: string, port: number): void {
  console.log("Client checklist:");
  console.log(`  1. Gateway running — ./start.sh status`);
  console.log(`  2. Base URL — http://${host}:${port}/v1`);
  console.log(`  3. API key — BRIDGE_API_KEY from .env.local (not CURSOR_API_KEY)`);
  console.log(`  4. Model ID — pick from GET /v1/models (e.g. composer-2.5)`);
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

let config;
try {
  config = loadConfig();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`verify-client: config error — ${message}`);
  console.error("Set CURSOR_API_KEY and BRIDGE_API_KEY in .env.local (chmod 600).");
  process.exit(1);
}

const base = `http://${config.host}:${config.port}`;
printChecklistHints(config.host, config.port);

let health;
try {
  health = await fetchJson(`${base}/health`);
} catch {
  console.error(`verify-client: cannot reach ${base}/health — start the gateway first: ./start.sh`);
  process.exit(1);
}

if (!health.ok) {
  console.error(`verify-client: /health returned HTTP ${health.status}`);
  process.exit(2);
}

const healthBody = health.body as { ok?: boolean } | null;
if (!healthBody?.ok) {
  console.error("verify-client: /health did not report ok: true");
  process.exit(2);
}

const models = await fetchJson(`${base}/v1/models`, {
  headers: { Authorization: `Bearer ${config.bridgeApiKey}` },
});

if (models.status === 401) {
  console.error("verify-client: /v1/models returned 401 — use BRIDGE_API_KEY, not CURSOR_API_KEY");
  process.exit(2);
}

if (!models.ok) {
  console.error(`verify-client: /v1/models returned HTTP ${models.status}`);
  process.exit(2);
}

const list = models.body as { data?: unknown[] } | null;
if (!Array.isArray(list?.data)) {
  console.error("verify-client: /v1/models response missing data array");
  process.exit(2);
}

console.log("CLIENT_OK");
process.exit(0);
