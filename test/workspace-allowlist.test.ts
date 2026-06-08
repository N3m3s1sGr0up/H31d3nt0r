import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Config } from "../src/config.js";
import { SERVICE_ROOT } from "../src/config.js";
import { resolveAllowedWorkspaceCwd } from "../src/cursor/workspace-allowlist.js";

import { ROUTE_CHAT_UPSTREAM_OFF, ROUTE_TIMEOUT_DEFAULTS } from "./test-timeouts-fixture.js";

function fixtureConfig(workspaceCwd: string | readonly string[]): Config {
  return {
    cursorApiKey: "k",
    bridgeApiKey: "b",
    host: "127.0.0.1",
    port: 8787,
    workspaceCwd,
    localSettingSources: ["project", "user"],
    maxAgents: 4,
    bridgeGeneration: 1,
    cursorReadyProbeTimeoutMs: 0,
    ...ROUTE_TIMEOUT_DEFAULTS,
  };
}

describe("resolveAllowedWorkspaceCwd", () => {
  let tmp: string;
  let extra: string;
  let nested: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "ws-allow-"));
    extra = path.join(tmp, "extra-root");
    nested = path.join(tmp, "nested");
    mkdirSync(extra, { recursive: true });
    mkdirSync(nested, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it("accepts a path under WORKSPACE_CWD", () => {
    const cfg = fixtureConfig(tmp);
    expect(resolveAllowedWorkspaceCwd(nested, cfg)).toBe(path.resolve(nested));
  });

  it("accepts a path equal to the workspace root", () => {
    const cfg = fixtureConfig(tmp);
    expect(resolveAllowedWorkspaceCwd(tmp, cfg)).toBe(path.resolve(tmp));
  });

  it("accepts paths under BRIDGE_EXTRA_CWD when configured", () => {
    const underExtra = path.join(extra, "child");
    mkdirSync(underExtra, { recursive: true });
    const cfg = fixtureConfig([tmp, extra]);
    expect(resolveAllowedWorkspaceCwd(underExtra, cfg)).toBe(path.resolve(underExtra));
  });

  it("accepts SERVICE_ROOT itself", () => {
    const cfg = fixtureConfig(tmp);
    expect(resolveAllowedWorkspaceCwd(SERVICE_ROOT, cfg)).toBe(path.resolve(SERVICE_ROOT));
  });

  it("rejects paths outside allowed roots", () => {
    const cfg = fixtureConfig(tmp);
    expect(resolveAllowedWorkspaceCwd("/etc/passwd", cfg)).toBeNull();
    expect(resolveAllowedWorkspaceCwd(path.join(tmp, "..", "outside"), cfg)).toBeNull();
  });

  it("rejects non-existent paths", () => {
    const cfg = fixtureConfig(tmp);
    expect(resolveAllowedWorkspaceCwd(path.join(tmp, "missing-dir"), cfg)).toBeNull();
  });
});
