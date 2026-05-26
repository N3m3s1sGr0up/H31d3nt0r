import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";

import { ROUTE_TIMEOUT_DEFAULTS } from "./test-timeouts-fixture.js";

function fixtureConfig() {
  return {
    cursorApiKey: "cursor-secret",
    bridgeApiKey: "bridge-secret",
    host: "127.0.0.1",
    port: 8787,
    workspaceCwd: ["/tmp/repo", "/tmp/.hermes"],
    hermesHomeDir: "/tmp/.hermes",
    localSettingSources: ["project", "user"] as const,
    maxAgents: 4,
    bridgeGeneration: 1_700_000_000_000,
    cursorReadyProbeTimeoutMs: 0,
    ...ROUTE_TIMEOUT_DEFAULTS,
  } satisfies Config;
}

describe("GET /v1/capabilities", () => {
  it("reports cursor-only backend", async () => {
    const { hono } = buildApp({ config: fixtureConfig() });
    const res = await hono.request("/v1/capabilities", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      inference_backend: string;
      hermes_home: string;
      workspace_cwd: string[];
      bridge_version: string;
      timeouts_ms: Record<string, number>;
      openai_upstream_chat: { mode: string; endpoint_host?: string };
    };
    expect(json.timeouts_ms.chat_completion_max).toBeGreaterThan(0);
    expect(json.bridge_version.length).toBeGreaterThan(0);
    expect(json.inference_backend).toBe("cursor_sdk_local");
    expect(json.openai_upstream_chat.mode).toBe("off");
    expect(json.openai_upstream_chat.endpoint_host).toBeUndefined();
    expect(json.hermes_home).toBe("/tmp/.hermes");
    expect(json.workspace_cwd).toEqual(["/tmp/repo", "/tmp/.hermes"]);
  });
});
