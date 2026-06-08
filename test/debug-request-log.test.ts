import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import {
  formatDebugRequestLog,
  type DebugRequestLogEntry,
} from "../src/middleware/debug-request-log.js";

import { ROUTE_TIMEOUT_DEFAULTS } from "./test-timeouts-fixture.js";

function fixtureConfig(debugRequests: boolean) {
  return {
    cursorApiKey: "cursor-secret",
    bridgeApiKey: "bridge-secret",
    host: "127.0.0.1",
    port: 8787,
    workspaceCwd: "/tmp/bridge-test-workspace",
    localSettingSources: ["project", "user"] as const,
    maxAgents: 4,
    bridgeGeneration: 1_700_000_000_000,
    cursorReadyProbeTimeoutMs: 0,
    ...ROUTE_TIMEOUT_DEFAULTS,
    debugRequests,
  };
}

describe("debug request logging", () => {
  it("formatDebugRequestLog emits structured JSON without secrets", () => {
    const entry: DebugRequestLogEntry = {
      type: "bridge.request",
      request_id: "req_test",
      method: "GET",
      path: "/v1/models",
      status: 200,
      duration_ms: 12,
    };
    const line = formatDebugRequestLog(entry);
    expect(line).toContain('"type":"bridge.request"');
    expect(line).not.toContain("Bearer");
    expect(line).not.toContain("bridge-secret");
    expect(JSON.parse(line)).toMatchObject(entry);
  });

  it("logs one line per /v1 request when debug flag is on", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { hono } = buildApp({
      config: fixtureConfig(true),
      cursorClient: {
        listModels: async () => [],
      } as never,
    });

    const res = await hono.request("http://localhost/v1/models", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    expect(res.status).toBe(200);

    const lines = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('"type":"bridge.request"'));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.join("\n")).not.toContain("Bearer");
    writeSpy.mockRestore();
  });

  it("does not log when debug flag is off", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { hono } = buildApp({
      config: fixtureConfig(false),
      cursorClient: {
        listModels: async () => [],
      } as never,
    });

    await hono.request("http://localhost/v1/models", {
      headers: { authorization: "Bearer bridge-secret" },
    });

    const lines = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('"type":"bridge.request"'));
    expect(lines).toHaveLength(0);
    writeSpy.mockRestore();
  });
});
