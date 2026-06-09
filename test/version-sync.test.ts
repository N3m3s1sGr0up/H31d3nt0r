import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BRIDGE_GENERATION_CHANGELOG } from "../src/bridge-metadata.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("version sync", () => {
  it("keeps package.json, package-lock.json, and changelog head aligned", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    const lock = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };

    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""]?.version).toBe(pkg.version);

    const head = BRIDGE_GENERATION_CHANGELOG[0] ?? "";
    expect(head.startsWith(`v${pkg.version}:`)).toBe(true);
  });
});
