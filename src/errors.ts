/**
 * Structured error envelope for /v1/*.
 *
 * Shape (R14):
 *   { "error": { "code": "<machine_code>", "message": "<human>",
 *                "error_id": "err_<hex>", "retryable"?: <bool>,
 *                "request_id"?: "<echo of X-Request-Id>" } }
 *
 * Agents parse `code` and (when retrying or correlating with logs) `error_id`.
 * Humans read `message`. Never put secrets, stack traces, or internal paths
 * in any of these fields — SDK error strings flow through `internalDetails`
 * to journald only.
 */

import { randomBytes } from "node:crypto";

import type { Context } from "hono";

import { tryRequestId } from "./request-id.js";

import {
  AuthenticationError,
  ConfigurationError,
  CursorAgentError,
  NetworkError,
  RateLimitError,
} from "@cursor/sdk";

import { TimeoutExceededError } from "./with-timeout.js";

export interface BridgeErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly error_id: string;
    readonly retryable?: boolean;
    /** Present when request-id middleware ran (matches `X-Request-Id` response header). */
    readonly request_id?: string;
    readonly type?: string;
    readonly param?: string | null;
  };
}

export type BridgeErrorCode =
  | "unauthorized"
  | "forbidden"
  | "bad_request"
  | "payload_too_large"
  | "not_found"
  | "model_not_found"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "rate_limited"
  | "stream_unsupported"
  | "agent_startup_failed"
  | "run_failed"
  | "run_cancelled"
  | "upstream_unreachable"
  | "sdk_connect_timeout"
  | "request_timeout"
  | "upstream_fetch_failed"
  | "upstream_timeout"
  | "internal_error";

function bridgeCodeToOpenAiType(code: BridgeErrorCode): { type: string; param: null } {
  switch (code) {
    case "unauthorized":
      return { type: "authentication_error", param: null };
    case "bad_request":
    case "payload_too_large":
    case "not_found":
    case "unsupported_media_type":
    case "stream_unsupported":
    case "method_not_allowed":
    case "model_not_found":
      return { type: "invalid_request_error", param: null };
    case "rate_limited":
      return { type: "rate_limit_error", param: null };
    case "upstream_timeout":
      return { type: "timeout_error", param: null };
    default:
      return { type: "api_error", param: null };
  }
}

export interface BridgeErrorOptions {
  /** Override the generated correlation id (mainly for tests). */
  readonly errorId?: string;
  /**
   * Server-only payload logged to stderr by `respondWithError`. Use this
   * for raw SDK error strings, stack traces, request ids — anything the
   * operator needs to debug but the client must never see.
   */
  readonly internalDetails?: Record<string, unknown>;
}

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly status: number;
  readonly retryable: boolean | undefined;
  readonly errorId: string;
  readonly internalDetails: Record<string, unknown> | undefined;

  constructor(
    code: BridgeErrorCode,
    status: number,
    message: string,
    retryable?: boolean,
    options: BridgeErrorOptions = {},
  ) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.errorId = options.errorId ?? newErrorId();
    this.internalDetails = options.internalDetails;
  }

  toBody(): BridgeErrorBody {
    const { type, param } = bridgeCodeToOpenAiType(this.code);
    const body: BridgeErrorBody = {
      error: {
        code: this.code,
        message: this.message,
        error_id: this.errorId,
        type,
        param,
      },
    };
    if (this.retryable !== undefined) {
      (body.error as { retryable?: boolean }).retryable = this.retryable;
    }
    return body;
  }
}

function newErrorId(): string {
  return `err_${randomBytes(8).toString("hex")}`;
}

export function unauthorized(message = "Bearer token required."): BridgeError {
  return new BridgeError("unauthorized", 401, message, false);
}

export function badRequest(message: string): BridgeError {
  return new BridgeError("bad_request", 400, message, false);
}

export function payloadTooLarge(
  message = "Request body exceeds size limit.",
): BridgeError {
  return new BridgeError("payload_too_large", 413, message, false);
}

export function notFound(message = "Not found."): BridgeError {
  return new BridgeError("not_found", 404, message, false);
}

export function unknownModel(modelId: string): BridgeError {
  return new BridgeError(
    "model_not_found",
    404,
    `The model '${modelId}' does not exist or access is forbidden.`,
    false,
  );
}

export function methodNotAllowed(message = "Method not allowed."): BridgeError {
  return new BridgeError("method_not_allowed", 405, message, false);
}

export function unsupportedMediaType(message: string): BridgeError {
  return new BridgeError("unsupported_media_type", 415, message, false);
}

export function streamUnsupported(reason?: string): BridgeError {
  const message = reason
    ? `Streaming not supported for this run: ${reason}. Poll for terminal status instead.`
    : "Streaming not supported for this run. Poll for terminal status instead.";
  return new BridgeError("stream_unsupported", 422, message, false);
}

export function rateLimited(
  message = "Rate limited by upstream.",
  options?: BridgeErrorOptions,
): BridgeError {
  return new BridgeError("rate_limited", 429, message, true, options);
}

export function agentStartupFailed(
  message: string,
  retryable: boolean,
  options?: BridgeErrorOptions,
): BridgeError {
  return new BridgeError("agent_startup_failed", 502, message, retryable, options);
}

/** Dependency probe failed (typically `/ready` Cursor listModels unreachable). */
export function upstreamUnreachable(
  message = "Upstream dependency not reachable for readiness probe.",
  options?: BridgeErrorOptions,
): BridgeError {
  return new BridgeError("upstream_unreachable", 503, message, true, options);
}

/** Bounded wait for Cursor streaming handshake exceeded the configured deadline. */
export function sdkConnectTimeout(
  message: string,
  options?: BridgeErrorOptions,
): BridgeError {
  return new BridgeError("sdk_connect_timeout", 504, message, true, options);
}

/** Non-stream chat completion breached `BRIDGE_CHAT_COMPLETION_MS` (or SSE wall clock). */
export function requestTimeout(message: string, options?: BridgeErrorOptions): BridgeError {
  return new BridgeError("request_timeout", 504, message, true, options);
}

export function runFailed(message: string, options?: BridgeErrorOptions): BridgeError {
  return new BridgeError("run_failed", 500, message, false, options);
}

export function internalError(
  message = "Internal error.",
  options?: BridgeErrorOptions,
): BridgeError {
  return new BridgeError("internal_error", 500, message, false, options);
}

export function upstreamFetchFailed(message: string, options?: BridgeErrorOptions): BridgeError {
  return new BridgeError("upstream_fetch_failed", 502, message, true, options);
}

export function upstreamTimeout(message: string, options?: BridgeErrorOptions): BridgeError {
  return new BridgeError("upstream_timeout", 504, message, true, options);
}

/**
 * Conservative defense-in-depth redactor. Replaces any run of 20+ chars from
 * the alnum+`_`+`-` alphabet with `[redacted]`. Catches Cursor API keys,
 * JWTs, hex tokens, base64 blobs — anything long, dense, and key-shaped.
 * Short identifiers (`composer-2.5`, model ids, request paths) pass through.
 *
 * Used for the ONE SDK error class we forward verbatim (`ConfigurationError`,
 * whose messages are validation-only and operator-useful). All other SDK
 * error classes produce sanitized static messages instead — see
 * `mapSdkStartupError`.
 */
const SECRET_LIKE = /[A-Za-z0-9_-]{20,}/g;
export function redactSecrets(text: string): string {
  return text.replace(SECRET_LIKE, "[redacted]");
}

/**
 * Map a Cursor SDK error (anything `Agent.create` / `Agent.prompt` /
 * `agent.send` / `Cursor.models.list` can throw) to a bridge error.
 *
 * Security invariant: the bridge NEVER reflects raw `err.message` text from
 * SDK errors into client responses, except for `ConfigurationError` after
 * redaction. SDK error strings can carry API keys (Cursor or upstream),
 * request URLs with query-string secrets, or other operator-only context.
 * The original SDK message lives only in `internalDetails`, which
 * `respondWithError` writes to stderr (journald) with the same `error_id`
 * the client received — so operators can correlate without leaking.
 *
 * Mapping:
 * - `ConfigurationError`  -> 400 bad_request, message forwarded + redacted
 * - `RateLimitError`      -> 429 rate_limited (retryable), static message
 * - `AuthenticationError` -> 502 agent_startup_failed (non-retryable),
 *                            generic "check CURSOR_API_KEY" message
 * - `NetworkError`        -> 502 agent_startup_failed (retryable), generic
 * - other `CursorAgentError` -> 502, retryable = err.isRetryable, generic
 * - other `Error`         -> 500 internal_error, generic
 * - unknown               -> 500 internal_error, generic
 */
export function mapSdkStartupError(err: unknown, prefix: string): BridgeError {
  const timeoutMapped = mapTimeoutExceededError(err);
  if (timeoutMapped !== undefined) {
    return timeoutMapped;
  }
  const internalDetails = sdkErrorDetails(err);

  if (err instanceof ConfigurationError) {
    return new BridgeError(
      "bad_request",
      400,
      `${prefix}: ${redactSecrets(err.message)}`,
      false,
      { internalDetails },
    );
  }
  if (err instanceof RateLimitError) {
    return rateLimited(`${prefix}: upstream rate limit reached.`, { internalDetails });
  }
  if (err instanceof AuthenticationError) {
    return agentStartupFailed(
      `${prefix}: Cursor authentication failed. Check CURSOR_API_KEY on the bridge host.`,
      false,
      { internalDetails },
    );
  }
  if (err instanceof NetworkError) {
    return agentStartupFailed(
      `${prefix}: upstream network error. See error_id in server logs.`,
      true,
      { internalDetails },
    );
  }
  if (err instanceof CursorAgentError) {
    return agentStartupFailed(
      `${prefix}: Cursor SDK reported an error. See error_id in server logs.`,
      err.isRetryable,
      { internalDetails },
    );
  }
  if (err instanceof Error) {
    return internalError(
      `${prefix}: unexpected error. See error_id in server logs.`,
      { internalDetails },
    );
  }
  return internalError(
    `${prefix}: unexpected error. See error_id in server logs.`,
    { internalDetails },
  );
}

function mapTimeoutExceededError(err: unknown): BridgeError | undefined {
  if (!(err instanceof TimeoutExceededError)) {
    return undefined;
  }
  if (
    err.phase === "streaming_chat_sdk_connect"
  ) {
    return sdkConnectTimeout(
      `Timed out talking to Cursor during streaming handshake.`,
      { internalDetails: { phase: err.phase, timeoutMs: err.timeoutMs } },
    );
  }
  if (err.phase === "readiness_models_list") {
    return upstreamUnreachable("Cursor readiness probe timed out.", {
      internalDetails: { phase: err.phase, timeoutMs: err.timeoutMs },
    });
  }
  if (err.phase === "non_stream_chat_complete") {
    return requestTimeout("Chat completion timed out before Cursor returned a terminal result.", {
      internalDetails: { phase: err.phase, timeoutMs: err.timeoutMs },
    });
  }
  return requestTimeout(`${err.phase.replaceAll("_", " ")} timed out on the bridge.`, {
    internalDetails: { phase: err.phase, timeoutMs: err.timeoutMs },
  });
}

function sdkErrorDetails(err: unknown): Record<string, unknown> {
  if (err instanceof CursorAgentError) {
    return {
      name: err.name,
      message: err.message,
      retryable: err.isRetryable,
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { value: String(err) };
}

/**
 * Write a `BridgeError` as the Hono response. When `internalDetails` is set
 * (SDK-derived errors, internal failures), also emits one structured JSON
 * log line to stderr containing the SDK message and the client-visible
 * `error_id`, so operators can correlate without exposing the SDK text.
 */
export function respondWithError(c: Context, err: BridgeError): Response {
  const rid = tryRequestId(c);
  const body = err.toBody();
  const responseBody = rid !== undefined ? { error: { ...body.error, request_id: rid } } : body;
  if (err.internalDetails !== undefined) {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "bridge error",
        ...(rid !== undefined ? { request_id: rid } : {}),
        error_id: err.errorId,
        code: err.code,
        status: err.status,
        sdk: err.internalDetails,
      }),
    );
  }
  return c.json(responseBody, err.status as never);
}
