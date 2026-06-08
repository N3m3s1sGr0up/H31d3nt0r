import { describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

const runIntegration = Boolean(process.env.RUN_CURSOR_INTEGRATION);
const hasCursorKey = Boolean(process.env.CURSOR_API_KEY?.trim());
const hasBridgeKey = Boolean(process.env.BRIDGE_API_KEY?.trim());

describe.skipIf(!runIntegration)("gateway live integration", () => {
  it.skipIf(!hasCursorKey || !hasBridgeKey)(
    "GET /health and GET /v1/models succeed in-process",
    async () => {
      const config = loadConfig();
      const { hono } = buildApp({ config });

      const health = await hono.request("http://localhost/health");
      expect(health.status).toBe(200);
      const healthJson = (await health.json()) as { ok?: boolean };
      expect(healthJson.ok).toBe(true);

      const models = await hono.request("http://localhost/v1/models", {
        headers: { authorization: `Bearer ${config.bridgeApiKey}` },
      });
      expect(models.status).toBe(200);
      const modelsJson = (await models.json()) as { data?: unknown[] };
      expect(Array.isArray(modelsJson.data)).toBe(true);
      expect((modelsJson.data ?? []).length).toBeGreaterThan(0);
    },
    45_000,
  );
});
