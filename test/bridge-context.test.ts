import { describe, expect, it } from "vitest";

import {
  buildBridgeSystemContext,
  prependBridgeContext,
} from "../src/cursor/bridge-context.js";

describe("bridge context", () => {
  it("includes primary workspace paths in system context", () => {
    const ctx = buildBridgeSystemContext({
      repoRoot: "/repo",
    });
    expect(ctx).toContain("/repo");
    expect(ctx).toContain("Primary workspace");
    expect(ctx).not.toContain("Additional workspace");
    expect(ctx).toContain("WORKSPACE OPSEC");
    expect(ctx).toContain("~/ops/<engagement>/");
    expect(ctx).toContain("do not claim you lack access unless a tool genuinely fails");
    expect(ctx).toContain("OPENAI_COMPAT_TOOL_JSON");
    expect(ctx).toContain("do not substitute Cursor SDK native tools");
  });

  it("uses client-tools mode when Hermes registers tools", () => {
    const ctx = buildBridgeSystemContext(
      { repoRoot: "/repo" },
      { clientToolsRegistered: true },
    );
    expect(ctx).toContain("CRITICAL — client tool execution");
    expect(ctx).toContain("Never tell the user a registered tool is unavailable");
    expect(ctx).not.toContain("do not claim you lack access unless a tool genuinely fails");
  });

  it("includes secondary workspace line when configured", () => {
    const ctx = buildBridgeSystemContext({
      repoRoot: "/repo",
      extraWorkspaceRoot: "/tmp/extra",
    });
    expect(ctx).toContain("- Additional workspace: /tmp/extra");
  });

  it("prepends context before existing system messages", () => {
    const out = prependBridgeContext(
      [
        { role: "system", content: "You are concise." },
        { role: "user", content: "hi" },
      ],
      "PREFIX",
    );
    expect(out[0]?.role).toBe("system");
    expect(out[0]?.content).toContain("PREFIX");
    expect(out[0]?.content).toContain("You are concise.");
  });
});
