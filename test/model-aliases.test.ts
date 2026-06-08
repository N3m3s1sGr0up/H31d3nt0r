import { describe, expect, it } from "vitest";

import { normalizeCursorModelId } from "../src/cursor/client.js";
import { resolveModelAlias } from "../src/cursor/model-aliases.js";

describe("resolveModelAlias", () => {
  it("maps composer2-5 to composer-2.5", () => {
    expect(resolveModelAlias("composer2-5")).toBe("composer-2.5");
  });

  it("passes through unknown models unchanged", () => {
    expect(resolveModelAlias("composer-2.5")).toBe("composer-2.5");
    expect(resolveModelAlias("gpt-4")).toBe("gpt-4");
  });
});

describe("normalizeCursorModelId", () => {
  it("strips cursor prefix then applies aliases", () => {
    expect(normalizeCursorModelId("cursor/composer2-5")).toBe("composer-2.5");
    expect(normalizeCursorModelId("cursor:composer2-5")).toBe("composer-2.5");
  });

  it("applies aliases without prefix", () => {
    expect(normalizeCursorModelId("composer2-5")).toBe("composer-2.5");
  });

  it("leaves canonical ids unchanged", () => {
    expect(normalizeCursorModelId("composer-2.5")).toBe("composer-2.5");
  });
});
