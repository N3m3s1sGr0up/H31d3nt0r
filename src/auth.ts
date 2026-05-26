import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

import type { MiddlewareHandler } from "hono";

import { respondWithError, unauthorized } from "./errors.js";

/**
 * Uniform message for every 401 failure mode (no oracle).
 *
 * Returning distinct strings for "missing header" / "wrong scheme" / "empty
 * bearer" / "bad token" lets an attacker probe whether they sent a valid
 * shape; collapsing them removes that signal.
 */
const UNAUTHORIZED_MESSAGE = "Invalid or missing bearer token.";

/**
 * Bearer middleware for /v1/*.
 *
 * - Constant-time compare on the token bytes to avoid timing leaks.
 * - Both the configured token and the presented token are trimmed of
 *   surrounding whitespace before comparison: keys sourced via `cat
 *   secret-file` commonly carry a trailing newline, and a single stray byte
 *   would otherwise lock the bridge out with a misleading "Invalid bearer
 *   token" error.
 * - Every failure mode returns the same structured 401 envelope and the
 *   same message — no per-failure-mode differentiation.
 */
export function bearerAuth(expected: string): MiddlewareHandler {
  const expectedTrimmed = expected.trim();
  if (expectedTrimmed.length === 0) {
    throw new Error("bearerAuth requires a non-empty token");
  }
  const expectedBuf = Buffer.from(expectedTrimmed, "utf8");

  return async (c, next) => {
    const header = c.req.header("authorization") ?? c.req.header("Authorization");
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      return respondWithError(c, unauthorized(UNAUTHORIZED_MESSAGE));
    }
    const presented = header.slice(7).trim();
    if (presented.length === 0) {
      return respondWithError(c, unauthorized(UNAUTHORIZED_MESSAGE));
    }
    const presentedBuf = Buffer.from(presented, "utf8");
    if (
      presentedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(presentedBuf, expectedBuf)
    ) {
      return respondWithError(c, unauthorized(UNAUTHORIZED_MESSAGE));
    }
    await next();
  };
}
