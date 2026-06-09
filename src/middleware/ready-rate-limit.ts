import type { MiddlewareHandler } from "hono";

import { rateLimited, respondWithError } from "../errors.js";

const WINDOW_MS = 60_000;

/**
 * Limits unauthenticated GET /ready probes (Cursor.models.list budget).
 * Disabled when `maxPerMin` is 0.
 */
export function readyRateLimitMiddleware(maxPerMin: number): MiddlewareHandler {
  const timestamps: number[] = [];

  return async (c, next) => {
    if (c.req.method !== "GET" || c.req.path !== "/ready") {
      await next();
      return;
    }

    const now = Date.now();
    while (timestamps.length > 0) {
      const oldest = timestamps[0];
      if (oldest === undefined || oldest >= now - WINDOW_MS) break;
      timestamps.shift();
    }

    if (timestamps.length >= maxPerMin) {
      return respondWithError(
        c,
        rateLimited("Ready probe rate limit exceeded; retry later."),
      );
    }

    timestamps.push(now);
    await next();
  };
}
