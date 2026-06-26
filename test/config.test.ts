import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, SERVICE_ROOT } from "../src/config.js";

const KEYS_TO_RESET = [
  "CURSOR_API_KEY",
  "BRIDGE_API_KEY",
  "HOST",
  "PORT",
  "WORKSPACE_CWD",
  "MAX_AGENTS",
  "CURSOR_LOCAL_SETTING_SOURCES",
  "CURSOR_AGENT_MCP_SERVERS",
  "BRIDGE_EXTRA_CWD",
  "WORKSPACE_CWD_ONLY",
  "BRIDGE_CHAT_UPSTREAM_MODE",
  "BRIDGE_CHAT_UPSTREAM_URL",
  "BRIDGE_CHAT_UPSTREAM_API_KEY",
  "OPENAI_API_KEY",
  "BRIDGE_CHAT_UPSTREAM_MS",
  "BRIDGE_DEBUG_REQUESTS",
  "BRIDGE_ALLOW_REMOTE_BIND",
  "BRIDGE_READY_RATE_LIMIT_PER_MIN",
  "BRIDGE_CHAT_UPSTREAM_HOST_ALLOWLIST",
  "BRIDGE_CONTEXT_FILE",
  "BRIDGE_CONTEXT_MAX_BYTES",
];

describe("loadConfig", () => {
  let savedEnv: Record<string, string | undefined>;
  let tmp: string;

  beforeEach(() => {
    savedEnv = {};
    for (const key of KEYS_TO_RESET) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmp = mkdtempSync(path.join(tmpdir(), "bridge-cfg-"));
  });

  afterEach(() => {
    for (const key of KEYS_TO_RESET) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws when CURSOR_API_KEY is missing", () => {
    process.env.BRIDGE_API_KEY = "bridge-secret";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(
      /CURSOR_API_KEY/,
    );
  });

  it("throws when BRIDGE_API_KEY is missing", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(
      /BRIDGE_API_KEY/,
    );
  });

  it("applies defaults when only required vars are set", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(8787);
    expect(cfg.maxAgents).toBe(4);
    expect(typeof cfg.bridgeGeneration).toBe("number");
    expect(cfg.bridgeGeneration).toBeGreaterThan(0);
    expect(cfg.workspaceCwd).toEqual(SERVICE_ROOT);
    expect(cfg.localSettingSources).toEqual(["project", "user"]);
    expect(cfg.chatUpstream.mode).toBe("off");
    expect(cfg.debugRequests).toBe(false);
  });

  it("enables debug request logging when BRIDGE_DEBUG_REQUESTS=1", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_DEBUG_REQUESTS = "1";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.debugRequests).toBe(true);
  });

  it("merges BRIDGE_EXTRA_CWD as a second workspace root", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_EXTRA_CWD = "/tmp/extra-ws";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.workspaceCwd).toEqual([SERVICE_ROOT, "/tmp/extra-ws"]);
  });

  it("ignores BRIDGE_EXTRA_CWD when WORKSPACE_CWD_ONLY=1", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_EXTRA_CWD = "/tmp/extra-ws";
    process.env.WORKSPACE_CWD_ONLY = "1";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.workspaceCwd).toEqual(SERVICE_ROOT);
  });

  it("rejects an invalid PORT", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.PORT = "not-a-port";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(
      /PORT/,
    );
  });

  it("rejects invalid CURSOR_LOCAL_SETTING_SOURCES tokens", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.CURSOR_LOCAL_SETTING_SOURCES = "mars";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(
      /CURSOR_LOCAL_SETTING_SOURCES/,
    );
  });

  it("parses comma-separated CURSOR_LOCAL_SETTING_SOURCES", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.CURSOR_LOCAL_SETTING_SOURCES = " project , user ";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.localSettingSources).toEqual(["project", "user"]);
  });

  it("rejects bad CURSOR_AGENT_MCP_SERVERS JSON", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.CURSOR_AGENT_MCP_SERVERS = "not-json";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(
      /CURSOR_AGENT_MCP_SERVERS/,
    );
  });

  it("parses CURSOR_AGENT_MCP_SERVERS object", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.CURSOR_AGENT_MCP_SERVERS = JSON.stringify({
      demo: { type: "stdio", command: "echo", args: ["hi"] },
    });
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.agentMcpServers).toMatchObject({
      demo: { type: "stdio", command: "echo", args: ["hi"] },
    });
  });

  it("reads .env.local but lets existing env override", () => {
    const dotEnvPath = path.join(tmp, ".env.local");
    writeFileSync(
      dotEnvPath,
      [
        "# example",
        'CURSOR_API_KEY="cursor-from-file"',
        "BRIDGE_API_KEY=bridge-from-file",
        "PORT=9999",
      ].join("\n"),
    );
    process.env.BRIDGE_API_KEY = "bridge-from-env";

    const cfg = loadConfig({ dotEnvPath });
    expect(cfg.cursorApiKey).toBe("cursor-from-file");
    expect(cfg.bridgeApiKey).toBe("bridge-from-env");
    expect(cfg.port).toBe(9999);
  });

  it("parses OpenAI-compat upstream knobs", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CHAT_UPSTREAM_MODE = "tools";
    process.env.BRIDGE_CHAT_UPSTREAM_URL = "https://api.openai.com/v1/chat/completions";
    process.env.BRIDGE_CHAT_UPSTREAM_API_KEY = "sk-upstream-test";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.chatUpstream.mode).toBe("tools");
    expect(cfg.chatUpstream.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(cfg.chatUpstream.apiKey).toBe("sk-upstream-test");
  });

  it("falls back to OPENAI_API_KEY when BRIDGE_CHAT_UPSTREAM_API_KEY omitted", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CHAT_UPSTREAM_MODE = "always";
    process.env.BRIDGE_CHAT_UPSTREAM_URL = "https://example.invalid/v1/chat/completions";
    process.env.OPENAI_API_KEY = "sk-shared";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.chatUpstream.apiKey).toBe("sk-shared");
    expect(cfg.chatUpstream.mode).toBe("always");
  });

  it("throws when upstream mode is enabled but URL/key missing", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CHAT_UPSTREAM_MODE = "tools";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(
      /BRIDGE_CHAT_UPSTREAM/,
    );
  });

  it("rejects non-loopback HOST without BRIDGE_ALLOW_REMOTE_BIND", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.HOST = "0.0.0.0";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(
      /BRIDGE_ALLOW_REMOTE_BIND/,
    );
  });

  it("allows non-loopback HOST when BRIDGE_ALLOW_REMOTE_BIND=1", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.HOST = "0.0.0.0";
    process.env.BRIDGE_ALLOW_REMOTE_BIND = "1";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.host).toBe("0.0.0.0");
  });

  it("rejects non-https upstream URLs", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CHAT_UPSTREAM_MODE = "tools";
    process.env.BRIDGE_CHAT_UPSTREAM_URL = "http://api.openai.com/v1/chat/completions";
    process.env.BRIDGE_CHAT_UPSTREAM_API_KEY = "sk-upstream-test";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(/https/);
  });

  it("enforces BRIDGE_CHAT_UPSTREAM_HOST_ALLOWLIST when set", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CHAT_UPSTREAM_MODE = "tools";
    process.env.BRIDGE_CHAT_UPSTREAM_URL = "https://evil.example/v1/chat/completions";
    process.env.BRIDGE_CHAT_UPSTREAM_API_KEY = "sk-upstream-test";
    process.env.BRIDGE_CHAT_UPSTREAM_HOST_ALLOWLIST = "api.openai.com";
    expect(() => loadConfig({ dotEnvPath: path.join(tmp, "noop") })).toThrow(
      /HOST_ALLOWLIST/,
    );
  });

  it("parses BRIDGE_READY_RATE_LIMIT_PER_MIN", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_READY_RATE_LIMIT_PER_MIN = "12";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.readyRateLimitPerMin).toBe(12);
  });

  it("leaves contextFilePath undefined and applies the default cap when unset", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.contextFilePath).toBeUndefined();
    expect(cfg.contextFileMaxBytes).toBe(16384);
  });

  it("keeps an absolute BRIDGE_CONTEXT_FILE path as-is", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CONTEXT_FILE = "/abs/context.md";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.contextFilePath).toBe("/abs/context.md");
  });

  it("resolves a relative BRIDGE_CONTEXT_FILE against SERVICE_ROOT", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CONTEXT_FILE = "context.md";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.contextFilePath).toBe(path.resolve(SERVICE_ROOT, "context.md"));
  });

  it("treats a whitespace-only BRIDGE_CONTEXT_FILE as unset", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CONTEXT_FILE = "   ";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.contextFilePath).toBeUndefined();
  });

  it("parses BRIDGE_CONTEXT_MAX_BYTES", () => {
    process.env.CURSOR_API_KEY = "cursor-secret";
    process.env.BRIDGE_API_KEY = "bridge-secret";
    process.env.BRIDGE_CONTEXT_MAX_BYTES = "2048";
    const cfg = loadConfig({ dotEnvPath: path.join(tmp, "noop") });
    expect(cfg.contextFileMaxBytes).toBe(2048);
  });
});
