import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { bearerAuth } from "./auth.js";
import type { Config } from "./config.js";
import { Semaphore } from "./concurrency.js";
import { CursorClient } from "./cursor/client.js";
import {
  BridgeError,
  internalError,
  methodNotAllowed,
  notFound,
  payloadTooLarge,
  redactSecrets,
  respondWithError,
} from "./errors.js";
import { readyRateLimitMiddleware } from "./middleware/ready-rate-limit.js";
import {
  parseContextLengthEnv,
  type ContextLengthTable,
} from "./openai/context-length.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerCapabilitiesRoute } from "./routes/openai/capabilities.js";
import { registerChatCompletionsRoute } from "./routes/openai/chat-completions.js";
import { registerModelsRoute } from "./routes/openai/models.js";
import { debugRequestLogMiddleware } from "./middleware/debug-request-log.js";
import { registerReadyRoute } from "./routes/ready.js";
import { requestIdMiddleware, tryRequestId } from "./request-id.js";

/**
 * Hard cap on /v1/chat/completions JSON bodies. 1 MiB comfortably fits any
 * realistic conversation history (even a 200-message thread of 5 KB each)
 * while preventing a single bearer-holding client from OOMing the bridge
 * with one large POST. Rejected with structured 413 payload_too_large.
 */
const CHAT_BODY_LIMIT_BYTES = 1 * 1024 * 1024;

export interface BuildAppOptions {
  readonly config: Config;
  /** Override the SDK client (used by tests). */
  readonly cursorClient?: CursorClient;
  /** Override the context_length table (used by tests). */
  readonly contextLengths?: ContextLengthTable;
  /** Override service start time (used by tests for deterministic uptime). */
  readonly startedAt?: number;
}

export interface BridgeApp {
  readonly hono: Hono;
  readonly config: Config;
  readonly cursorClient: CursorClient;
}

/**
 * Assemble the Hono app without binding a port. `src/index.ts` wires this up
 * to `@hono/node-server`; tests drive `app.hono.request(...)` directly.
 */
export function buildApp(options: BuildAppOptions): BridgeApp {
  const { config } = options;
  const cursorClient =
    options.cursorClient ??
    new CursorClient({
      cursorApiKey: config.cursorApiKey,
      workspaceCwd: config.workspaceCwd,
      localSettingSources: config.localSettingSources,
      agentMcpServers: config.agentMcpServers,
    });
  const startedAt = options.startedAt ?? Date.now();
  const contextLengths =
    options.contextLengths ?? parseContextLengthEnv(process.env.MODEL_CONTEXT_LENGTHS);

  const agentSemaphore = new Semaphore(config.maxAgents);

  const hono = new Hono();

  hono.use(requestIdMiddleware);

  registerHealthRoute(hono, config, startedAt);
  if (config.readyRateLimitPerMin > 0) {
    hono.use("/ready", readyRateLimitMiddleware(config.readyRateLimitPerMin));
  }
  registerReadyRoute(hono, { config, cursorClient, startedAt });

  hono.use("/v1/*", debugRequestLogMiddleware(config.debugRequests));
  hono.use("/v1/*", bearerAuth(config.bridgeApiKey));
  hono.use(
    "/v1/chat/completions",
    bodyLimit({
      maxSize: CHAT_BODY_LIMIT_BYTES,
      onError: (c) =>
        respondWithError(
          c,
          payloadTooLarge(
            `Request body exceeds ${CHAT_BODY_LIMIT_BYTES} byte limit on /v1/chat/completions.`,
          ),
        ),
    }),
  );
  registerModelsRoute(hono, { cursorClient, contextLengths });
  registerCapabilitiesRoute(hono, { config });
  registerChatCompletionsRoute(hono, { cursorClient, agentSemaphore, config });

  hono.notFound((c) => respondWithError(c, notFound()));

  hono.onError((err, c) => {
    if (err instanceof BridgeError) {
      return respondWithError(c, err);
    }
    if (isMethodNotAllowed(err)) {
      return respondWithError(c, methodNotAllowed());
    }
    const rid = tryRequestId(c);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "unhandled error",
        ...(rid !== undefined ? { request_id: rid } : {}),
        name: err.name,
        message: redactSecrets(err.message),
      }),
    );
    return respondWithError(c, internalError());
  });

  return { hono, config, cursorClient };
}

function isMethodNotAllowed(err: Error): boolean {
  return /method not allowed/i.test(err.message);
}
