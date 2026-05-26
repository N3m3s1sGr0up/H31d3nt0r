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
  "HERMES_HOME",
  "WORKSPACE_CWD_ONLY",
  "BRIDGE_CHAT_UPSTREAM_MODE",
  "BRIDGE_CHAT_UPSTREAM_URL",
  "BRIDGE_CHAT_UPSTREAM_API_KEY",
  "OPENAI_API_KEY",
  "BRIDGE_CHAT_UPSTREAM_MS",
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
    tmp = mkdtempSync(path.join(tmpdir(), "hermes-cfg-"));
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
    expect(cfg.workspaceCwd).toEqual([SERVICE_ROOT, cfg.hermesHomeDir]);
    expect(cfg.localSettingSources).toEqual(["project", "user"]);
    expect(cfg.hermesHomeDir).toContain(".hermes");
    expect(cfg.chatUpstream.mode).toBe("off");
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
});
