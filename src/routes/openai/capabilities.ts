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
    return c.json({
      bridge_version: meta.version,
      bridge_generation_notes: [...meta.generationChangelog],
      bridge_generation: config.bridgeGeneration,
      inference_backend:
        config.chatUpstream.mode === "always"
          ? "openai_compatible_upstream"
          : "cursor_sdk_local",
      openai_upstream_chat: {
        mode: config.chatUpstream.mode,
        timeout_ms: config.chatUpstream.timeoutMs,
        endpoint_host: upstreamEndpointHost(config.chatUpstream.url),
      },
      request_correlation:
        "Every response echoes `X-Request-Id` (from client `X-Request-Id` when valid ASCII alnum/`._:-` ≤128 chars, else bridge-generated `req_*`). JSON `/v1/*` errors include `error.request_id` when present; streaming terminal `bridge.error` objects may include `error.request_id` for log correlation.",
      workspace_cwd: Array.isArray(cwd) ? cwd : [cwd],
      hermes_home: config.hermesHomeDir,
      timeouts_ms: {
        chat_completion_max: config.chatCompletionTimeoutMs,
        chat_stream_max: config.chatStreamTimeoutMs,
        sdk_stream_connect: config.sdkStreamingConnectTimeoutMs,
        readiness_models_probe: config.cursorReadyProbeTimeoutMs,
        sse_heartbeat_ping: config.sseHeartbeatIntervalMs,
      },
      cursor_setting_sources: config.localSettingSources,
      hermes_openai_tool_loop:
        "Configure BRIDGE_CHAT_UPSTREAM_* for Hermes-native tool_calls via an OpenAI-compatible upstream (modes: off | tools | always). Fallback: Cursor runs with injected tool defs plus optional HERMES_BRIDGE_TOOL_JSON tail parse on assistant text.",
      cursor_native_model_prefixes: ["cursor/", "cursor:"],
      optional_mcp: "Set CURSOR_AGENT_MCP_SERVERS to attach extra MCP servers to every Cursor run.",
    });
  });
}
