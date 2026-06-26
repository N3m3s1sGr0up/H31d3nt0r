import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { promptSpy } = vi.hoisted(() => ({
  promptSpy: vi.fn(
    async (_prompt: string, _opts?: unknown) => ({
      id: "run-test",
      status: "finished",
      result: "ok",
    }),
  ),
}));

vi.mock("@cursor/sdk", () => ({
  Agent: {
    prompt: promptSpy,
    create: vi.fn(),
  },
  Cursor: {
    models: { list: vi.fn(async () => []) },
  },
}));

import { CursorClient } from "../src/cursor/client.js";

describe("CursorClient operator-context injection", () => {
  let tmp: string;

  beforeEach(() => {
    promptSpy.mockClear();
    tmp = mkdtempSync(path.join(tmpdir(), "ctx-inject-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("injects operator context into the composed prompt", async () => {
    const file = path.join(tmp, "context.md");
    writeFileSync(file, "House rule: never force-push to main.");
    const client = new CursorClient({
      cursorApiKey: "k",
      workspaceCwd: tmp,
      contextFilePath: file,
    });

    await client.chatComplete([{ role: "user", content: "hi" }], "composer-2");

    expect(promptSpy).toHaveBeenCalledTimes(1);
    const prompt = promptSpy.mock.calls[0]?.[0] ?? "";
    expect(prompt).toContain("Operator context (standing instructions");
    expect(prompt).toContain("House rule: never force-push to main.");
  });

  it("omits the operator context section when no file is configured", async () => {
    const client = new CursorClient({ cursorApiKey: "k", workspaceCwd: tmp });

    await client.chatComplete([{ role: "user", content: "hi" }], "composer-2");

    const prompt = promptSpy.mock.calls[0]?.[0] ?? "";
    expect(prompt).not.toContain("Operator context");
  });
});
