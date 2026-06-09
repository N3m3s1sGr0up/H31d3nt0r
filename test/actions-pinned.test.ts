import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("actions:verify", () => {
  it("requires full SHA pins in workflow uses entries", () => {
    const out = execSync("npm run actions:verify", {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("actions:verify ok");
  });
});
