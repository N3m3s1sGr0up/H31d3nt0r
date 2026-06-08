import { describe, expect, it } from "vitest";

import { Cursor } from "@cursor/sdk";

const runIntegration = Boolean(process.env.RUN_CURSOR_INTEGRATION);
const hasCursorKey = Boolean(process.env.CURSOR_API_KEY?.trim());

describe.skipIf(!runIntegration)("cursor SDK integration", () => {
  it.skipIf(!hasCursorKey)("lists at least one model via Cursor.models.list", async () => {
    const models = await Cursor.models.list({
      apiKey: process.env.CURSOR_API_KEY!,
    });
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(typeof models[0]?.id).toBe("string");
  }, 30_000);
});
