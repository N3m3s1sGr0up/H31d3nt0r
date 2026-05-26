import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { CursorClient } from "../src/cursor/client.js";
import type { Config } from "../src/config.js";

import type { SDKModel } from "@cursor/sdk";

import { ROUTE_TIMEOUT_DEFAULTS } from "./test-timeouts-fixture.js";

const SAMPLE_READY_MODEL: SDKModel = { id: "composer-2", displayName: "Composer 2" };

function fakeClient(impl: Partial<CursorClient>): CursorClient {
  return impl as unknown as CursorClient;
}

function baseFixture(overrides: Partial<Config> = {}): Config {
  return {
    cursorApiKey: "cursor-secret",
    bridgeApiKey: "bridge-secret",
    host: "127.0.0.1",
    port: 8787,
    workspaceCwd: "/tmp/repo",
    localSettingSources: ["project", "user"] as const,
    maxAgents: 4,
    bridgeGeneration: 1,
    cursorReadyProbeTimeoutMs: 2_000,
    ...ROUTE_TIMEOUT_DEFAULTS,
    ...overrides,
  };
}

describe("GET /ready", () => {
  it("skips Cursor models probe when BRIDGE_CURSOR_READY_MS=0", async () => {
    const { hono } = buildApp({
      config: baseFixture({ cursorReadyProbeTimeoutMs: 0 }),
      cursorClient: fakeClient({
        listModels: async () => {
          throw new Error("should not reach listModels()");
        },
      }),
    });

    const res = await hono.request("http://localhost/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { readiness?: { cursor_sdk?: string } };
    expect(body.readiness?.cursor_sdk).toBe("skipped");
  });

  it("returns 500 when listModels rejects under the readiness budget", async () => {
    const { hono } = buildApp({
      config: baseFixture({ cursorReadyProbeTimeoutMs: 5_000 }),
      cursorClient: fakeClient({
        listModels: async () => {
          throw new Error("network boom");
        },
      }),
    });

    const res = await hono.request("http://localhost/ready");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string; retryable?: boolean } };
    expect(body.error?.retryable).toBe(false);
    expect(body.error?.code).toBe("internal_error");
  });

  it("returns 200 when listModels resolves before the deadline", async () => {
    const listModels = vi.fn(async (): Promise<SDKModel[]> => [SAMPLE_READY_MODEL]);

    const { hono } = buildApp({
      config: baseFixture({ cursorReadyProbeTimeoutMs: 5_000 }),
      cursorClient: fakeClient({ listModels }),
    });

    const res = await hono.request("http://localhost/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { readiness?: { cursor_sdk?: string } };
    expect(body.readiness?.cursor_sdk).toBe("ok");
    expect(listModels).toHaveBeenCalledOnce();
  });
});
