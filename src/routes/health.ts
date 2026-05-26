import type { Hono } from "hono";

import { bridgeReleaseMetadata } from "../bridge-metadata.js";
import type { Config } from "../config.js";

/**
 * Liveness probe used by systemd / ops. Unauthenticated by design (R7 — health
 * is the probe systemd / curl run before bearer is configured). Exposes only
 * non-sensitive fields: never include CURSOR_API_KEY, BRIDGE_API_KEY, or
 * internal paths.
 */
export function registerHealthRoute(
  app: Hono,
  config: Pick<Config, "bridgeGeneration">,
  startedAt: number = Date.now(),
): void {
  app.get("/health", (c) => {
    const meta = bridgeReleaseMetadata();
    return c.json({
      ok: true,
      bridgeGeneration: config.bridgeGeneration,
      changelog: [...meta.generationChangelog],
      uptimeSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
      service: "h31d3nt0r",
      version: meta.version,
    });
  });
}
