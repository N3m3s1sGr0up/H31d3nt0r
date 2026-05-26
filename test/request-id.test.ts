import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { deriveRequestId } from "../src/request-id.js";

import type { Config } from "../src/config.js";
import { CursorClient } from "../src/cursor/client.js";

import { ROUTE_TIMEOUT_DEFAULTS } from "./test-timeouts-fixture.js";

function fixtureConfig(): Config {
  return {
    cursorApiKey: "cursor-secret",
    bridgeApiKey: "bridge-secret",
    host: "127.0.0.1",
    port: 8787,
    workspaceCwd: "/tmp/hermes-test-workspace",
    hermesHomeDir: "/tmp/.hermes",
    localSettingSources: ["project", "user"] as const,
    maxAgents: 4,
    bridgeGeneration: 1,
    cursorReadyProbeTimeoutMs: 0,
    ...ROUTE_TIMEOUT_DEFAULTS,
  };
}

describe("deriveRequestId", () => {
  it("minted when blank or malformed", () => {
    expect(deriveRequestId(undefined)).toMatch(/^req_[a-f0-9]{24}$/);
    expect(deriveRequestId("")).toMatch(/^req_[a-f0-9]{24}$/);
    expect(deriveRequestId("   ")).toMatch(/^req_[a-f0-9]{24}$/);
    expect(deriveRequestId("has space")).toMatch(/^req_/);
    expect(deriveRequestId("no-unicode-\u0394")).toMatch(/^req_/);
  });

  it("allows safe literals up to 128 chars", () => {
    expect(deriveRequestId("Hermes-thread-007")).toBe("Hermes-thread-007");
    const pad = `a.${"b".repeat(120)}:c`; // ≤128 incl dots/colon
    expect(deriveRequestId(pad)).toBe(pad);
  });

  it("refuses oversized headers", () => {
    const long = `x.${"z".repeat(130)}`; // >128 chars
    expect(deriveRequestId(long)).toMatch(/^req_/);
  });
});

describe("X-Request-Id middleware", () => {
  it("Echoes sanitized client ids on GET /health", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: new CursorClient({
        cursorApiKey: "cursor-secret",
        workspaceCwd: "/tmp/hermes-test-workspace",
        hermesHomeDir: "/tmp/.hermes",
      }),
    });
    const res = await hono.request("http://localhost/health", {
      headers: { "x-request-id": "trace-alpha" },
    });
    expect(res.headers.get("X-Request-Id")).toBe("trace-alpha");
  });

  it("Generates a fresh id when the header violates the allowed alphabet", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: new CursorClient({
        cursorApiKey: "cursor-secret",
        workspaceCwd: "/tmp/hermes-test-workspace",
        hermesHomeDir: "/tmp/.hermes",
      }),
    });
    const res = await hono.request("http://localhost/health", {
      headers: { "x-request-id": "!!!illegal!!!" },
    });
    const rid = res.headers.get("X-Request-Id");
    expect(rid).not.toContain("!");
    expect(rid).toMatch(/^req_[a-f0-9]{24}$/);
  });

  it("Includes request_id in JSON errors", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: new CursorClient({
        cursorApiKey: "cursor-secret",
        workspaceCwd: "/tmp/hermes-test-workspace",
        hermesHomeDir: "/tmp/.hermes",
      }),
    });
    const res = await hono.request("http://localhost/does-not-exist", {
      headers: { "x-request-id": "corr-401-style" },
    });
    const body = (await res.json()) as { error?: { request_id?: string } };
    expect(body.error?.request_id).toBe("corr-401-style");
    expect(res.headers.get("X-Request-Id")).toBe("corr-401-style");
  });
});
