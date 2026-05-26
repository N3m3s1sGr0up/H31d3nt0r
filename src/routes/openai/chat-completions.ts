import { randomBytes } from "node:crypto";

import type { RunResult } from "@cursor/sdk";
import { stream as honoStream } from "hono/streaming";
import type { Context, Hono } from "hono";

import type { Semaphore, SemaphoreLease } from "../../concurrency.js";
import type { CursorClient, OpenAiToolBridgeInput } from "../../cursor/client.js";
import { normalizeCursorModelId } from "../../cursor/client.js";
import type { Config } from "../../config.js";
import type { ParsedChatCompletionRequest } from "../../openai/chat-normalize.js";
import {
  normalizedToBridgeMessages,
  parseChatCompletionBody,
} from "../../openai/chat-normalize.js";
import {
  badRequest,
  mapSdkStartupError,
  rateLimited,
  respondWithError,
  runFailed,
  streamUnsupported,
  upstreamFetchFailed,
  upstreamTimeout,
} from "../../errors.js";
import {
  buildStreamTerminalError,
  contentChunk,
  createAssistantTextTracker,
  finalText,
  openingChunk,
  SSE_DONE,
  sseComment,
  sseEvent,
  sseStreamTerminalErrorEnvelope,
  terminalChunk,
  toolCallsDeltaChunk,
} from "../../openai/map-stream.js";
import {
  collectToolNames,
  parseBridgeToolJsonFromAssistantText,
} from "../../openai/tool-bridge.js";
import type { OpenAIChatCompletion, OpenAIToolCall } from "../../openai/types.js";
import type { ChatUpstreamConfig } from "../../openai/upstream-proxy.js";
import { upstreamOpenAiCompatibleFetch, wantsUpstreamInference } from "../../openai/upstream-proxy.js";
import { tryRequestId } from "../../request-id.js";
import { withTimeout } from "../../with-timeout.js";

const CURSOR_DUMMY_USAGE = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
} as const;

export interface ChatCompletionsRouteDeps {
  readonly config: Config;
  readonly cursorClient: CursorClient;
  readonly agentSemaphore?: Semaphore;
  readonly now?: () => number;
  readonly idGen?: () => string;
}

function newChatCompletionId(): string {
  return `chatcmpl-${randomBytes(12).toString("hex")}`;
}

function toolBridgeFromParsed(parsed: ParsedChatCompletionRequest): OpenAiToolBridgeInput | undefined {
  if (!parsed.tools || parsed.tools.length === 0) return undefined;
  return { tools: parsed.tools, toolChoice: parsed.tool_choice };
}

export function registerChatCompletionsRoute(
  app: Hono,
  deps: ChatCompletionsRouteDeps,
): void {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const idGen = deps.idGen ?? newChatCompletionId;

  app.post("/v1/chat/completions", async (c) => {
    if (!c.req.header("content-type")?.toLowerCase().includes("application/json")) {
      return respondWithError(
        c,
        badRequest("Content-Type must be application/json."),
      );
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return respondWithError(c, badRequest("Invalid JSON body."));
    }

    const parsed = parseChatCompletionBody(raw);
    if (!parsed.ok) {
      return respondWithError(c, badRequest(parsed.message));
    }
    const body = parsed.body;

    if (wantsUpstreamInference(deps.config.chatUpstream, body)) {
      return handleUpstreamProxy(c, body, deps.agentSemaphore, deps.config.chatUpstream);
    }

    const cursorModel = normalizeCursorModelId(body.model);
    const bridgeMessages = normalizedToBridgeMessages(body.messages);

    if (body.stream === true) {
      return handleStreaming(
        c,
        deps.cursorClient,
        bridgeMessages,
        body,
        cursorModel,
        idGen,
        deps.agentSemaphore,
        deps.config,
      );
    }

    const id = idGen();
    return handleNonStreaming(
      c,
      deps.cursorClient,
      bridgeMessages,
      body,
      cursorModel,
      id,
      now(),
      deps.agentSemaphore,
      deps.config,
    );
  });
}

function acquireOrReject(
  c: Context,
  sem: Semaphore | undefined,
): { lease: SemaphoreLease | null } | Response {
  if (sem === undefined) return { lease: null };
  const lease = sem.tryAcquire();
  if (lease !== null) return { lease };
  c.header("Retry-After", "1");
  return respondWithError(
    c,
    rateLimited("Bridge at capacity (MAX_AGENTS). Retry shortly."),
  );
}

function readableWithLease(body: ReadableStream<Uint8Array>, lease: SemaphoreLease | null): ReadableStream<Uint8Array> {
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    lease?.release();
  };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          release();
          return;
        }
        controller.enqueue(chunk.value);
      } catch (err) {
        release();
        controller.error(err);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });
}

async function handleUpstreamProxy(
  c: Context,
  parsed: ParsedChatCompletionRequest,
  sem: Semaphore | undefined,
  upstreamCfg: ChatUpstreamConfig,
): Promise<Response> {
  const acquired = acquireOrReject(c, sem);
  if (acquired instanceof Response) return acquired;
  const lease = acquired.lease;
  const fwdId = tryRequestId(c);
  try {
    const upstream = await upstreamOpenAiCompatibleFetch({
      cfg: upstreamCfg,
      parsed,
      clientAbortSignal: c.req.raw.signal,
      forwardedRequestId: fwdId,
    });
    const hdrs = new Headers();
    hdrs.delete("transfer-encoding");

    const ct = upstream.headers.get("content-type");
    if (ct) hdrs.set("content-type", ct);

    hdrs.set("cache-control", "no-store");

    const rid = fwdId ?? "";
    if (rid.length > 0) hdrs.set("X-Request-Id", rid);

    if (!upstream.ok && !parsed.stream) {
      const text = await upstream.text();
      lease?.release();
      return new Response(text, {
        status: upstream.status,
        headers: hdrs,
      });
    }

    const b = upstream.body;
    if (b === null) {
      lease?.release();
      return new Response(upstream.statusText || "", { status: upstream.status, headers: hdrs });
    }

    return new Response(readableWithLease(b, lease), {
      status: upstream.status,
      headers: hdrs,
    });
  } catch (err: unknown) {
    lease?.release();
    const isAbort =
      typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as Error).name === "AbortError";
    if (isAbort) {
      return respondWithError(
        c,
        upstreamTimeout("OpenAI-compat upstream aborted (client disconnect or upstream timeout budget)."),
      );
    }
    return respondWithError(
      c,
      upstreamFetchFailed("Failed to reach the configured OpenAI-compatible upstream.", {
        internalDetails: err instanceof Error ? { name: err.name, message: err.message } : {},
      }),
    );
  }
}

function makeChatCompletion(
  id: string,
  model: string,
  assistant: { content: string | null; tool_calls?: readonly OpenAIToolCall[] },
  createdSec: number,
): OpenAIChatCompletion {
  const hasTools =
    assistant.tool_calls !== undefined && assistant.tool_calls.length > 0;
  return {
    id,
    object: "chat.completion",
    created: createdSec,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: assistant.content,
          ...(hasTools ? { tool_calls: assistant.tool_calls } : {}),
        },
        finish_reason: hasTools ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function parseAssistantFromRun(
  openAiBody: ParsedChatCompletionRequest,
  text: string,
): { content: string | null; tool_calls?: readonly OpenAIToolCall[] } {
  if (openAiBody.tools && openAiBody.tools.length > 0) {
    return parseBridgeToolJsonFromAssistantText(text, collectToolNames(openAiBody.tools));
  }
  const t = text.trimEnd();
  return { content: t.length > 0 ? t : null };
}

async function handleNonStreaming(
  c: Context,
  client: CursorClient,
  messages: ReturnType<typeof normalizedToBridgeMessages>,
  parsed: ParsedChatCompletionRequest,
  model: string,
  completionId: string,
  createdSec: number,
  sem: Semaphore | undefined,
  cfg: Config,
): Promise<Response> {
  const acquired = acquireOrReject(c, sem);
  if (acquired instanceof Response) return acquired;
  try {
    const bridgeInput = toolBridgeFromParsed(parsed);
    const result = await withTimeout(
      client.chatComplete(messages, model, bridgeInput),
      cfg.chatCompletionTimeoutMs,
      "non_stream_chat_complete",
    );
    if (result.status === "error") {
      return respondWithError(c, runFailed(`Cursor run failed (id=${result.id}).`));
    }
    const assistant = parseAssistantFromRun(parsed, result.result ?? "");
    const completion = makeChatCompletion(completionId, model, assistant, createdSec);
    if (result.status === "cancelled") {
      return c.json({ ...completion, status: "cancelled" });
    }
    return c.json(completion);
  } catch (err) {
    return respondWithError(c, mapSdkStartupError(err, "Chat completion failed"));
  } finally {
    acquired.lease?.release();
  }
}

async function handleStreaming(
  c: Context,
  client: CursorClient,
  messages: ReturnType<typeof normalizedToBridgeMessages>,
  parsed: ParsedChatCompletionRequest,
  model: string,
  idGen: () => string,
  sem: Semaphore | undefined,
  cfg: Config,
): Promise<Response> {
  const acquired = acquireOrReject(c, sem);
  if (acquired instanceof Response) return acquired;
  const lease = acquired.lease;

  const bridgeInput = toolBridgeFromParsed(parsed);
  const bufferTools = Boolean(bridgeInput?.tools && bridgeInput.tools.length > 0);

  let handle;
  try {
    handle = await withTimeout(
      client.openStreamingChat(messages, model, bridgeInput),
      cfg.sdkStreamingConnectTimeoutMs,
      "streaming_chat_sdk_connect",
    );
  } catch (err) {
    lease?.release();
    return respondWithError(c, mapSdkStartupError(err, "Chat stream failed to start"));
  }

  const { agent, run } = handle;
  if (!run.supports("stream")) {
    try {
      await agent[Symbol.asyncDispose]();
    } catch (disposeErr) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "agent dispose failed on stream_unsupported",
          name: disposeErr instanceof Error ? disposeErr.name : "unknown",
        }),
      );
    }
    lease?.release();
    return respondWithError(c, streamUnsupported(run.unsupportedReason("stream")));
  }

  const includeUsageDummy = parsed.stream_options?.include_usage === true;

  const id = idGen();
  const ctx = { id, model };
  const streamDeadlineMs = cfg.chatStreamTimeoutMs;
  const heartbeatMs = cfg.sseHeartbeatIntervalMs;
  const correlated = tryRequestId(c);

  return honoStream(c, async (out) => {
    let abortedByPeer = false;
    let abortedByDeadline = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = (): void => {
      if (heartbeat !== undefined) clearInterval(heartbeat);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    };

    const stopRun = (): void => {
      void (async () => {
        try {
          if (run.supports("cancel")) await run.cancel();
        } catch {
          /* swallow */
        }
      })();
    };

    out.onAbort(() => {
      abortedByPeer = true;
      stopRun();
    });

    if (heartbeatMs > 0) {
      heartbeat = setInterval(() => {
        void (async () => {
          try {
            await out.write(sseComment(`bridge-heartbeat ${Date.now()}`));
          } catch {
            /* stream closed */
          }
        })();
      }, heartbeatMs);
      heartbeat.unref?.();
    }

    if (streamDeadlineMs > 0) {
      deadlineTimer = setTimeout(() => {
        abortedByDeadline = true;
        stopRun();
      }, streamDeadlineMs);
      deadlineTimer.unref?.();
    }

    c.header("Content-Type", "text/event-stream; charset=utf-8");
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("Connection", "keep-alive");

    const tracker = createAssistantTextTracker();

    const writeBridgeStreamErrorAndDone = async (params: {
      readonly code: "stream_upstream_failure" | "stream_wall_clock_timeout" | "stream_client_disconnect";
      readonly message: string;
      readonly retryable: boolean;
    }): Promise<void> => {
      try {
        const payload = buildStreamTerminalError({
          ...params,
          ...(correlated !== undefined ? { request_id: correlated } : {}),
        });
        await out.write(sseStreamTerminalErrorEnvelope(payload));
      } catch {
        /* swallow */
      }
      try {
        await out.write(SSE_DONE);
      } catch {
        /* swallow */
      }
    };

    const finishReasonFor = (
      parsedAssistant: ReturnType<typeof parseAssistantFromRun>,
    ): "stop" | "tool_calls" => {
      const hasTools =
        parsedAssistant.tool_calls !== undefined &&
        parsedAssistant.tool_calls.length > 0;
      return hasTools ? "tool_calls" : "stop";
    };

    const finalizeSuccessfulStream = async (result: RunResult): Promise<void> => {
      const dummyUsage = includeUsageDummy ? CURSOR_DUMMY_USAGE : undefined;
      if (result.status === "error") {
        const remaining = finalText(result, tracker);
        if (bufferTools) {
          const parsedAssistant = parseAssistantFromRun(parsed, remaining);
          const text = parsedAssistant.content ?? "";
          if (text.length > 0) await out.write(sseEvent(contentChunk(ctx, text)));
          if (parsedAssistant.tool_calls?.length) {
            await out.write(sseEvent(toolCallsDeltaChunk(ctx, [...parsedAssistant.tool_calls])));
          }
          await out.write(sseEvent(terminalChunk(ctx, finishReasonFor(parsedAssistant), dummyUsage)));
        } else {
          if (remaining.length > tracker.current().length) {
            const delta = remaining.slice(tracker.current().length);
            await out.write(sseEvent(contentChunk(ctx, delta)));
          }
          await out.write(sseEvent(terminalChunk(ctx, "stop", dummyUsage)));
        }
      } else {
        const finalContent = finalText(result, tracker);
        if (bufferTools) {
          const parsedAssistant = parseAssistantFromRun(parsed, finalContent);
          const text = parsedAssistant.content ?? "";
          if (text.length > 0) await out.write(sseEvent(contentChunk(ctx, text)));
          if (parsedAssistant.tool_calls?.length) {
            await out.write(sseEvent(toolCallsDeltaChunk(ctx, [...parsedAssistant.tool_calls])));
          }
          await out.write(sseEvent(terminalChunk(ctx, finishReasonFor(parsedAssistant), dummyUsage)));
        } else {
          if (finalContent.length > tracker.current().length) {
            const delta = finalContent.slice(tracker.current().length);
            await out.write(sseEvent(contentChunk(ctx, delta)));
          }
          await out.write(sseEvent(terminalChunk(ctx, "stop", dummyUsage)));
        }
      }
      await out.write(SSE_DONE);
    };

    try {
      await out.write(sseEvent(openingChunk(ctx)));
      for await (const msg of run.stream()) {
        if (abortedByDeadline || abortedByPeer) {
          break;
        }
        if (bufferTools) {
          tracker.consume(msg);
        } else {
          const delta = tracker.consume(msg);
          if (delta !== undefined && delta.length > 0) {
            await out.write(sseEvent(contentChunk(ctx, delta)));
          }
        }
      }

      if (abortedByDeadline) {
        await writeBridgeStreamErrorAndDone({
          code: "stream_wall_clock_timeout",
          message:
            "Chat streaming exceeded BRIDGE_CHAT_STREAM_MS on the bridge before completion; cancelling the Cursor run.",
          retryable: true,
        });
      } else if (abortedByPeer) {
        await writeBridgeStreamErrorAndDone({
          code: "stream_client_disconnect",
          message: "HTTP client aborted the SSE connection; cancelling the Cursor run.",
          retryable: true,
        });
      } else {
        await finalizeSuccessfulStream(await run.wait());
      }
    } catch (err) {
      const payload = buildStreamTerminalError({
        code: "stream_upstream_failure",
        message:
          "Unexpected failure streaming tokens from Cursor before `[DONE]`; inspect bridge logs alongside error_id.",
        retryable: true,
        ...(correlated !== undefined ? { request_id: correlated } : {}),
      });
      console.error(
        JSON.stringify({
          level: "error",
          msg: "chat stream iterator failed",
          ...(correlated !== undefined ? { request_id: correlated } : {}),
          error_id: payload.error.error_id,
          stream_code: payload.error.code,
          name: err instanceof Error ? err.name : "unknown",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
      try {
        await out.write(sseStreamTerminalErrorEnvelope(payload));
      } catch {
        /* swallow */
      }
      try {
        await out.write(SSE_DONE);
      } catch {
        /* swallow */
      }
    } finally {
      clearTimers();
      try {
        await agent[Symbol.asyncDispose]();
      } catch {
        /* swallow */
      }
      lease?.release();
    }
  });
}
