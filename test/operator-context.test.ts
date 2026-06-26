import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OperatorContextReader } from "../src/cursor/operator-context.js";

describe("OperatorContextReader", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "operator-ctx-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns undefined when no path is configured", () => {
    const reader = new OperatorContextReader();
    expect(reader.configured).toBe(false);
    expect(reader.load()).toBeUndefined();
  });

  it("returns trimmed file contents", () => {
    const file = path.join(tmp, "context.md");
    writeFileSync(file, "  Deploy notes: prefer ripgrep.  \n");
    const reader = new OperatorContextReader({ path: file });
    expect(reader.configured).toBe(true);
    expect(reader.load()).toBe("Deploy notes: prefer ripgrep.");
  });

  it("returns undefined for a missing file without throwing", () => {
    const reader = new OperatorContextReader({ path: path.join(tmp, "nope.md") });
    expect(reader.load()).toBeUndefined();
  });

  it("returns undefined for an empty / whitespace-only file", () => {
    const file = path.join(tmp, "empty.md");
    writeFileSync(file, "   \n\t\n");
    const reader = new OperatorContextReader({ path: file });
    expect(reader.load()).toBeUndefined();
  });

  it("picks up changes when the file mtime/size changes", () => {
    const file = path.join(tmp, "context.md");
    writeFileSync(file, "first");
    const reader = new OperatorContextReader({ path: file });
    expect(reader.load()).toBe("first");

    writeFileSync(file, "second revision");
    // Force a distinct mtime in case the test writes within the same tick.
    const future = new Date(Date.now() + 2000);
    utimesSync(file, future, future);
    expect(reader.load()).toBe("second revision");
  });

  it("truncates content beyond maxBytes and marks the truncation", () => {
    const file = path.join(tmp, "big.md");
    writeFileSync(file, "x".repeat(100));
    const reader = new OperatorContextReader({ path: file, maxBytes: 10 });
    const out = reader.load();
    expect(out).toContain("operator context truncated");
    expect(out?.startsWith("xxxxxxxxxx")).toBe(true);
  });
});
