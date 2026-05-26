import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { McpServerConfig, SettingSource } from "@cursor/sdk";

import type { ChatUpstreamConfig, ChatUpstreamMode } from "./openai/upstream-proxy.js";

export interface Config {
  /** Cursor platform API key, used to authenticate SDK runs. Server-side only. */
  readonly cursorApiKey: string;
  /** Shared secret clients send as `Authorization: Bearer ...` on /v1/*. */
  readonly bridgeApiKey: string;
  readonly host: string;
  readonly port: number;
  /** Cursor SDK local cwd — install root plus optional extra tree (see `BRIDGE_EXTRA_CWD`). */
  readonly workspaceCwd: string | readonly string[];
  /**
   * Cursor layers for `AgentOptions.local.settingSources`.
   * Defaults to `project,user` via env parsing — see `.env.local.example`.
   */
  readonly localSettingSources: readonly SettingSource[];
  /**
   * Optional `AgentOptions.mcpServers` passed on every Cursor run —
   * register stdio/HTTP MCP explicitly. JSON object keyed by alias.
   * See `CURSOR_AGENT_MCP_SERVERS`.
   */
  readonly agentMcpServers?: Readonly<Record<string, McpServerConfig>>;
  /** Reserved for v2 (agent CRUD). Honored only where applicable in v1. */
  readonly maxAgents: number;
  /**
   * Monotonic restart marker. Stamped once at process start; v2 exposes this
   * via `/v1/context` so clients can detect stale IDs after a restart.
   */
  readonly bridgeGeneration: number;

  /** `Agent.prompt` non-stream ceiling (ms). Zero disables enforcement. */
  readonly chatCompletionTimeoutMs: number;
  /** Established SSE `/v1/chat/completions` ceiling (ms) before cancelling + SSE error chunk. Zero disables. */
  readonly chatStreamTimeoutMs: number;
  /** `Agent.create` + `send` handshake bound for streaming runs (ms). Zero disables. */
  readonly sdkStreamingConnectTimeoutMs: number;
  /** `GET /ready` probes `Cursor.models.list` behind this deadline (ms). Zero skips the Cursor cloud probe (response still succeeds with `checks.cursor=false`; use `/health` for liveness-only). Non-zero probes fail with HTTP 503 + structured error when unreachable. */
  readonly cursorReadyProbeTimeoutMs: number;
  /** Periodic SSE `: comment` pings (ms) so intermediaries idle-open the TCP session. Zero disables. */
  readonly sseHeartbeatIntervalMs: number;
  /**
   * Optional OpenAI-compatible HTTPS endpoint for canonical `tool_calls` when
   * proxying chat upstream. Cursor remains the fallback when mode is off.
   */
  readonly chatUpstream: ChatUpstreamConfig;
}

export const SERVICE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const DOTENV_LOCAL_PATH = path.join(SERVICE_ROOT, ".env.local");

/**
 * Minimal .env.local loader (no dependency). Lines like `KEY=value`, optional
 * surrounding single or double quotes on the value, comments starting with `#`.
 * Existing `process.env` values win — env always overrides the file so systemd
 * `Environment=` directives keep their precedence.
 */
function loadDotEnvLocal(filePath: string = DOTENV_LOCAL_PATH): void {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required env var ${name}. Set it in .env.local beside package.json (chmod 600) or export it before starting.`,
    );
  }
  return value;
}

function parsePort(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid PORT=${raw}; expected an integer between 1 and 65535.`);
  }
  return n;
}

function parseMaxAgents(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid MAX_AGENTS=${raw}; expected a positive integer.`);
  }
  return n;
}

function parseNonNegativeMillis(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid ${name}=${raw}; expected a non-negative integer (ms).`);
  }
  return n;
}

const SETTING_SOURCE_IDS = new Set<SettingSource>([
  "project",
  "user",
  "team",
  "mdm",
  "plugins",
  "all",
]);

function parseCommaSettingSources(raw: string | undefined): readonly SettingSource[] {
  if (raw === undefined || raw.trim().length === 0) {
    return ["project", "user"];
  }
  const parts = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const token of parts) {
    if (!SETTING_SOURCE_IDS.has(token as SettingSource)) {
      throw new Error(
        `Invalid CURSOR_LOCAL_SETTING_SOURCES token "${token}"; allowed: project,user,team,mdm,plugins,all`,
      );
    }
  }
  return parts as SettingSource[];
}

function parseAgentMcpServers(raw: string | undefined): Record<string, McpServerConfig> | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CURSOR_AGENT_MCP_SERVERS must be valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CURSOR_AGENT_MCP_SERVERS must be a JSON object (server name → config).");
  }
  return parsed as Record<string, McpServerConfig>;
}

export interface LoadConfigOptions {
  /** Override the .env.local path (used by tests). */
  readonly dotEnvPath?: string;
}

function parseChatUpstreamMode(raw: string | undefined): ChatUpstreamMode {
  if (!raw?.trim()) {
    return "off";
  }
  const token = raw.trim().toLowerCase();
  if (token === "off" || token === "tools" || token === "always") {
    return token;
  }
  throw new Error(
    `Invalid BRIDGE_CHAT_UPSTREAM_MODE=${raw}; expected \"off\", \"tools\", or \"always\".`,
  );
}

function parseChatUpstreamConfig(): ChatUpstreamConfig {
  const mode = parseChatUpstreamMode(process.env.BRIDGE_CHAT_UPSTREAM_MODE);
  const rawUrl = process.env.BRIDGE_CHAT_UPSTREAM_URL?.trim();
  const apiKeyRaw =
    process.env.BRIDGE_CHAT_UPSTREAM_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined;
  const timeoutMs = parseNonNegativeMillis(
    "BRIDGE_CHAT_UPSTREAM_MS",
    process.env.BRIDGE_CHAT_UPSTREAM_MS,
    120_000,
  );
  const url = rawUrl?.length ? rawUrl : undefined;
  const apiKey = apiKeyRaw?.length ? apiKeyRaw : undefined;
  if (mode !== "off" && (!url?.length || !apiKey?.length)) {
    throw new Error(
      `BRIDGE_CHAT_UPSTREAM_MODE=${mode} requires BRIDGE_CHAT_UPSTREAM_URL plus BRIDGE_CHAT_UPSTREAM_API_KEY (or OPENAI_API_KEY).`,
    );
  }
  return { mode, url, apiKey, timeoutMs };
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  loadDotEnvLocal(options.dotEnvPath ?? DOTENV_LOCAL_PATH);
  return {
    cursorApiKey: required("CURSOR_API_KEY", process.env.CURSOR_API_KEY),
    bridgeApiKey: required("BRIDGE_API_KEY", process.env.BRIDGE_API_KEY),
    host: process.env.HOST ?? "127.0.0.1",
    port: parsePort(process.env.PORT ?? "8787"),
    workspaceCwd: (() => {
      const repoRoot = process.env.WORKSPACE_CWD ?? SERVICE_ROOT;
      const extra = process.env.BRIDGE_EXTRA_CWD?.trim();
      if (process.env.WORKSPACE_CWD_ONLY === "1" || !extra) {
        return repoRoot;
      }
      return repoRoot === extra ? repoRoot : [repoRoot, extra];
    })(),
    localSettingSources: parseCommaSettingSources(process.env.CURSOR_LOCAL_SETTING_SOURCES),
    agentMcpServers: parseAgentMcpServers(process.env.CURSOR_AGENT_MCP_SERVERS),
    maxAgents: parseMaxAgents(process.env.MAX_AGENTS ?? "4"),
    bridgeGeneration: Date.now(),
    chatCompletionTimeoutMs: parseNonNegativeMillis(
      "BRIDGE_CHAT_COMPLETION_MS",
      process.env.BRIDGE_CHAT_COMPLETION_MS,
      900_000,
    ),
    chatStreamTimeoutMs: parseNonNegativeMillis(
      "BRIDGE_CHAT_STREAM_MS",
      process.env.BRIDGE_CHAT_STREAM_MS,
      900_000,
    ),
    sdkStreamingConnectTimeoutMs: parseNonNegativeMillis(
      "BRIDGE_SDK_STREAM_CONNECT_MS",
      process.env.BRIDGE_SDK_STREAM_CONNECT_MS,
      120_000,
    ),
    cursorReadyProbeTimeoutMs: parseNonNegativeMillis(
      "BRIDGE_CURSOR_READY_MS",
      process.env.BRIDGE_CURSOR_READY_MS,
      12_000,
    ),
    sseHeartbeatIntervalMs: parseNonNegativeMillis(
      "BRIDGE_SSE_HEARTBEAT_MS",
      process.env.BRIDGE_SSE_HEARTBEAT_MS,
      15_000,
    ),
    chatUpstream: parseChatUpstreamConfig(),
  };
}
