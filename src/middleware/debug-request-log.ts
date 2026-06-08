import type { Context, MiddlewareHandler } from "hono";

import { tryRequestId } from "../request-id.js";

export interface DebugRequestLogEntry {
  readonly type: "bridge.request";
  readonly request_id?: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly duration_ms: number;
  readonly model?: string;
}

export function formatDebugRequestLog(entry: DebugRequestLogEntry): string {
  return JSON.stringify(entry);
}

async function peekChatModel(c: Context): Promise<string | undefined> {
  if (c.req.path !== "/v1/chat/completions" || c.req.method !== "POST") {
    return undefined;
  }
  const ct = c.req.header("content-type")?.toLowerCase() ?? "";
  if (!ct.includes("application/json")) return undefined;
  try {
    const clone = c.req.raw.clone();
    const text = await clone.text();
    const parsed = JSON.parse(text) as { model?: unknown };
    return typeof parsed.model === "string" && parsed.model.length > 0
      ? parsed.model
      : undefined;
  } catch {
    return undefined;
  }
}

/** Structured JSON request logs to stderr when `BRIDGE_DEBUG_REQUESTS=1`. Never logs secrets or bodies. */
export function debugRequestLogMiddleware(enabled: boolean): MiddlewareHandler {
  if (!enabled) {
    return async (_c, next) => next();
  }
  return async (c, next) => {
    const start = Date.now();
    const model = await peekChatModel(c);
    await next();
    const entry: DebugRequestLogEntry = {
      type: "bridge.request",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Date.now() - start,
      ...(tryRequestId(c) !== undefined ? { request_id: tryRequestId(c) } : {}),
      ...(model !== undefined ? { model } : {}),
    };
    process.stderr.write(`${formatDebugRequestLog(entry)}\n`);
  };
}
