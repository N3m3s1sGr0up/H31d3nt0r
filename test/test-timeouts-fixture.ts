import type { Config } from "../src/config.js";

import type { ChatUpstreamConfig } from "../src/openai/upstream-proxy.js";

export const ROUTE_CHAT_UPSTREAM_OFF: ChatUpstreamConfig = {
  mode: "off",
  url: undefined,
  apiKey: undefined,
  timeoutMs: 120_000,
};

/** Mirrors production defaults so route fixtures stay consistent across tests. */
export const ROUTE_TIMEOUT_DEFAULTS = {
  chatCompletionTimeoutMs: 900_000,
  chatStreamTimeoutMs: 900_000,
  sdkStreamingConnectTimeoutMs: 120_000,
  sseHeartbeatIntervalMs: 0,
  chatUpstream: ROUTE_CHAT_UPSTREAM_OFF,
  debugRequests: false,
  readyRateLimitPerMin: 0,
  contextFileMaxBytes: 16384,
} satisfies Pick<
  Config,
  | "chatCompletionTimeoutMs"
  | "chatStreamTimeoutMs"
  | "sdkStreamingConnectTimeoutMs"
  | "sseHeartbeatIntervalMs"
  | "chatUpstream"
  | "debugRequests"
  | "readyRateLimitPerMin"
  | "contextFileMaxBytes"
>;
