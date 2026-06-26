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
    workspaceCwd: ["/tmp/repo", "/tmp/extra-context"],
    localSettingSources: ["project", "user"] as const,
    maxAgents: 4,
    bridgeGeneration: 1_700_000_000_000,
    cursorReadyProbeTimeoutMs: 0,
    ...ROUTE_TIMEOUT_DEFAULTS,
  } satisfies Config;
}

const EXPECTED_TOP_LEVEL_KEYS = [
  "agent_capabilities",
  "bridge_generation",
  "bridge_generation_notes",
  "bridge_version",
  "cursor_native_model_prefixes",
  "cursor_sandbox",
  "cursor_setting_sources",
  "extra_workspace_cwd",
  "inference_backend",
  "openai_tool_routing",
  "openai_upstream_chat",
  "optional_mcp",
  "request_correlation",
  "suggested_base_url",
  "timeouts_ms",
  "workspace_cwd",
] as const;

describe("GET /v1/capabilities", () => {
  it("reports cursor-only backend", async () => {
    const { hono } = buildApp({ config: fixtureConfig() });
    const res = await hono.request("/v1/capabilities", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      inference_backend: string;
      extra_workspace_cwd: string | null;
      workspace_cwd: string[];
      bridge_version: string;
      suggested_base_url: string;
      timeouts_ms: Record<string, number>;
      openai_upstream_chat: { mode: string; endpoint_host?: string };
    };
    expect(json.timeouts_ms.chat_completion_max).toBeGreaterThan(0);
    expect(json.bridge_version.length).toBeGreaterThan(0);
    expect(json.inference_backend).toBe("cursor_sdk_local");
    expect(json.openai_upstream_chat.mode).toBe("off");
    expect(json.openai_upstream_chat.endpoint_host).toBeUndefined();
    expect(json.extra_workspace_cwd).toBe("/tmp/extra-context");
    expect(json.workspace_cwd).toEqual(["/tmp/repo", "/tmp/extra-context"]);
    expect(json.suggested_base_url).toBe("http://127.0.0.1:8787/v1");
  });

  it("preserves additive top-level keys", async () => {
    const { hono } = buildApp({ config: fixtureConfig() });
    const res = await hono.request("/v1/capabilities", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual([...EXPECTED_TOP_LEVEL_KEYS].sort());
  });

  it("advertises agent_capabilities for the cursor backend", async () => {
    const { hono } = buildApp({ config: fixtureConfig() });
    const res = await hono.request("/v1/capabilities", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      agent_capabilities: {
        inference_backend: string;
        workspace_roots: string[];
        client_tool_bridge: { protocol: string };
        operator_context: { configured: boolean; path: string | null };
      };
    };
    const caps = json.agent_capabilities;
    expect(caps.inference_backend).toBe("cursor_sdk_local");
    expect(caps.workspace_roots).toEqual(["/tmp/repo", "/tmp/extra-context"]);
    expect(caps.client_tool_bridge.protocol).toBe("OPENAI_COMPAT_TOOL_JSON");
    expect(caps.operator_context.configured).toBe(false);
    expect(caps.operator_context.path).toBeNull();
  });

  it("reports operator_context as configured when a context file path is set", async () => {
    const { hono } = buildApp({
      config: { ...fixtureConfig(), contextFilePath: "/tmp/context.md" },
    });
    const res = await hono.request("/v1/capabilities", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    const json = (await res.json()) as {
      agent_capabilities: { operator_context: { configured: boolean; path: string | null } };
    };
    expect(json.agent_capabilities.operator_context.configured).toBe(true);
    expect(json.agent_capabilities.operator_context.path).toBe("/tmp/context.md");
  });

  it("advertises the openai upstream backend in agent_capabilities when always-proxying", async () => {
    const { hono } = buildApp({
      config: {
        ...fixtureConfig(),
        chatUpstream: {
          mode: "always",
          url: "https://api.openai.com/v1/chat/completions",
          apiKey: "sk-test",
          timeoutMs: 120_000,
        },
      },
    });
    const res = await hono.request("/v1/capabilities", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    const json = (await res.json()) as {
      agent_capabilities: { inference_backend: string };
    };
    expect(json.agent_capabilities.inference_backend).toBe("openai_compatible_upstream");
  });

  it("reflects non-default host and port in suggested_base_url", async () => {
    const { hono } = buildApp({
      config: { ...fixtureConfig(), host: "127.0.0.1", port: 9999 },
    });
    const res = await hono.request("/v1/capabilities", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { suggested_base_url: string };
    expect(json.suggested_base_url).toBe("http://127.0.0.1:9999/v1");
  });
});
