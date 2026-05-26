import { describe, expect, it } from "vitest";

import {
  buildBridgeSystemContext,
  prependBridgeContext,
} from "../src/cursor/bridge-context.js";

describe("bridge context", () => {
  it("includes hermes paths in system context", () => {
    const ctx = buildBridgeSystemContext({
      repoRoot: "/repo",
      hermesHome: "/home/user/.hermes",
    });
    expect(ctx).toContain("/repo");
    expect(ctx).toContain("/home/user/.hermes/SOUL.md");
    expect(ctx).toContain("compound-engineering");
    expect(ctx).toContain("/home/user/.hermes/skills/compound-engineering/");
    expect(ctx).toContain("do not say you cannot work on this computer");
  });

  it("prepends context before existing system messages", () => {
    const out = prependBridgeContext(
      [
        { role: "system", content: "You are Anton." },
        { role: "user", content: "hi" },
      ],
      "BRIDGE",
    );
    expect(out[0]?.role).toBe("system");
    expect(out[0]?.content).toContain("BRIDGE");
    expect(out[0]?.content).toContain("You are Anton.");
  });
});
