import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { CursorClient } from "../src/cursor/client.js";
import type { Config } from "../src/config.js";

import { ROUTE_TIMEOUT_DEFAULTS } from "./test-timeouts-fixture.js";

function fixtureConfig(overrides: Partial<{ bridgeGeneration: number }> = {}) {
  return {
    cursorApiKey: "cursor-secret",
    bridgeApiKey: "bridge-secret",
    host: "127.0.0.1",
    port: 8787,
    workspaceCwd: "/tmp/hermes-test-workspace",
    hermesHomeDir: "/tmp/.hermes",
    localSettingSources: ["project", "user"] as const,
    maxAgents: 4,
    bridgeGeneration: overrides.bridgeGeneration ?? 1_700_000_000_000,
    cursorReadyProbeTimeoutMs: 0,
    ...ROUTE_TIMEOUT_DEFAULTS,
  } satisfies Config;
}

function buildTestApp() {
  return buildApp({
    config: fixtureConfig(),
    cursorClient: new CursorClient({
      cursorApiKey: "cursor-secret",
      workspaceCwd: "/tmp/hermes-test-workspace",
      hermesHomeDir: "/tmp/.hermes",
    }),
  });
}

describe("GET /health", () => {
  it("returns 200 with the expected shape and no secrets", async () => {
    const { hono } = buildTestApp();
    const res = await hono.request("http://localhost/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.service).toBe("hermes-cursor-api");
    expect(body.bridgeGeneration).toBe(1_700_000_000_000);
    expect(typeof body.uptimeSec).toBe("number");
    expect(typeof body.version).toBe("string");
    expect(Array.isArray(body.changelog)).toBe(true);
    const changelogEntries = body.changelog as unknown[];
    expect(changelogEntries.some((entry) => String(entry).includes("timeouts"))).toBe(true);
    expect(body).not.toHaveProperty("cursorApiKey");
    expect(body).not.toHaveProperty("bridgeApiKey");
    expect(JSON.stringify(body)).not.toContain("cursor-secret");
    expect(JSON.stringify(body)).not.toContain("bridge-secret");
  });

  it("does not require a bearer token (ops probe path)", async () => {
    const { hono } = buildTestApp();
    const res = await hono.request("http://localhost/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });
});

describe("404 envelope", () => {
  it("returns the structured error envelope for unknown routes", async () => {
    const { hono } = buildTestApp();
    const res = await hono.request("http://localhost/does/not/exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("not_found");
  });
});
