import type { Hono } from "hono";

import { bridgeReleaseMetadata } from "../bridge-metadata.js";
import type { Config } from "../config.js";
import type { CursorClient } from "../cursor/client.js";
import { mapSdkStartupError, respondWithError } from "../errors.js";
import { withTimeout } from "../with-timeout.js";

export interface ReadyRouteDeps {
  readonly config: Config;
  readonly cursorClient: CursorClient;
  readonly startedAt: number;
}

/**
 * Dependency readiness probe. No bearer token — behaves like Kubernetes
 * readiness: HTTP 503 when `Cursor.models.list` cannot complete within its
 * budget. When `cursorReadyProbeTimeoutMs` is zero, the Cursor handshake is
 * skipped (HTTP 200) so operators relying solely on `/health` are unaffected.
 */
export function registerReadyRoute(app: Hono, deps: ReadyRouteDeps): void {
  app.get("/ready", async (c) => {
    const { config } = deps;
    const uptimeSec = Math.max(0, Math.round((Date.now() - deps.startedAt) / 1000));
    const meta = bridgeReleaseMetadata();
    const base = {
      ok: true as const,
      service: "h31d3nt0r",
      version: meta.version,
      uptimeSec,
      bridgeGeneration: config.bridgeGeneration,
      changelog: [...meta.generationChangelog],
    };

    const probeBudget = config.cursorReadyProbeTimeoutMs;

    if (probeBudget <= 0) {
      return c.json({
        ...base,
        readiness: { cursor_sdk: "skipped" },
      });
    }

    try {
      await withTimeout(deps.cursorClient.listModels(), probeBudget, "readiness_models_list");
      return c.json({
        ...base,
        readiness: { cursor_sdk: "ok" },
      });
    } catch (err) {
      return respondWithError(c, mapSdkStartupError(err, "Cursor readiness probe failed"));
    }
  });
}
