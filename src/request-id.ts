import { randomBytes } from "node:crypto";

import type { Context, MiddlewareHandler } from "hono";

/** Printable token safe for logs and downstream tracing (Hermes/custom provider). */
const INCOMING_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function deriveRequestId(incomingHeader: string | undefined): string {
  const trimmed = incomingHeader?.trim();
  if (trimmed !== undefined && trimmed.length > 0 && INCOMING_ID.test(trimmed)) {
    return trimmed;
  }
  return `req_${randomBytes(12).toString("hex")}`;
}

/** Works when request-id middleware is absent (narrow unit harnesses). */
export function tryRequestId(c: Context): string | undefined {
  const id = (c.var as Record<string, unknown>).requestId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/** Assigns context `requestId` and echoes `X-Request-Id` on the response after the handler runs. */
export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const id = deriveRequestId(c.req.header("x-request-id"));
  c.set("requestId", id);
  await next();
  c.header("X-Request-Id", id);
};
