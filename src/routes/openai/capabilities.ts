import { existsSync } from "node:fs";

import type { Hono } from "hono";

import { bridgeReleaseMetadata } from "../../bridge-metadata.js";
import type { Config } from "../../config.js";

function upstreamEndpointHost(raw: string | undefined): string | undefined {
  if (!raw?.length) return undefined;
  try {
    return new URL(raw).hostname;
  } catch {
    return undefined;
  }
}

export interface CapabilitiesRouteDeps {
  readonly config: Config;
}

export function registerCapabilitiesRoute(
  app: Hono,
  deps: CapabilitiesRouteDeps,
): void {
  app.get("/v1/capabilities", (c) => {
    const { config } = deps;
    const cwd = config.workspaceCwd;
    const meta = bridgeReleaseMetadata();
    const workspaceRoots = Array.isArray(cwd) ? cwd : [cwd];
    const inferenceBackend =
      config.chatUpstream.mode === "always"
        ? "openai_compatible_upstream"
        : "cursor_sdk_local";
    return c.json({
      suggested_base_url: `http://${config.host}:${config.port}/v1`,
      bridge_version: meta.version,
      bridge_generation_notes: [...meta.generationChangelog],
      bridge_generation: config.bridgeGeneration,
      inference_backend: inferenceBackend,
      agent_capabilities: {
        inference_backend: inferenceBackend,
        native_tooling:
          "cursor_sdk_local runs expose filesystem + shell tools (Read, Shell, Grep, …) scoped to workspace_cwd; not used when inference_backend is openai_compatible_upstream.",
        workspace_roots: workspaceRoots,
        sandbox:
          config.sandboxEnabled === undefined ? "sdk_default" : config.sandboxEnabled,
        client_tool_bridge: {
          protocol: "OPENAI_COMPAT_TOOL_JSON",
          activation: "send a non-empty tools[] array on /v1/chat/completions",
          execution:
            "client-side: the gateway returns tool_calls; the client runs the tool and returns the result on the next turn.",
        },
        operator_context: {
          configured: Boolean(config.contextFilePath),
          path: config.contextFilePath ?? null,
          loaded:
            config.contextFilePath !== undefined && existsSync(config.contextFilePath),
        },
      },
      openai_upstream_chat: {
        mode: config.chatUpstream.mode,
        timeout_ms: config.chatUpstream.timeoutMs,
        endpoint_host: upstreamEndpointHost(config.chatUpstream.url),
      },
      request_correlation:
        "Every response echoes `X-Request-Id` (from client `X-Request-Id` when valid ASCII alnum/`._:-` ≤128 chars, else bridge-generated `req_*`). JSON `/v1/*` errors include `error.request_id` when present; streaming terminal `bridge.error` objects may include `error.request_id` for log correlation.",
      workspace_cwd: Array.isArray(cwd) ? cwd : [cwd],
      extra_workspace_cwd:
        Array.isArray(config.workspaceCwd) && config.workspaceCwd.length > 1
          ? config.workspaceCwd[1]
          : null,
      timeouts_ms: {
        chat_completion_max: config.chatCompletionTimeoutMs,
        chat_stream_max: config.chatStreamTimeoutMs,
        sdk_stream_connect: config.sdkStreamingConnectTimeoutMs,
        readiness_models_probe: config.cursorReadyProbeTimeoutMs,
        sse_heartbeat_ping: config.sseHeartbeatIntervalMs,
      },
      cursor_setting_sources: config.localSettingSources,
      cursor_sandbox:
        config.sandboxEnabled === undefined ? "sdk_default" : config.sandboxEnabled,
      openai_tool_routing:
        "BRIDGE_CHAT_UPSTREAM_* forwards /v1/chat/completions to an OpenAI-compatible upstream when enabled (modes: off | tools | always). Otherwise Cursor handles chat; for tool callbacks over the Cursor path, see docs/reference/openai-extensions.md (OPENAI_COMPAT_TOOL_JSON).",
      cursor_native_model_prefixes: ["cursor/", "cursor:"],
      optional_mcp: "Set CURSOR_AGENT_MCP_SERVERS to attach extra MCP servers to every Cursor run.",
    });
  });
}
