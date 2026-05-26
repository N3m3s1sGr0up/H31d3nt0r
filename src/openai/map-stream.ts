import { randomBytes } from "node:crypto";

import type { RunResult, SDKMessage } from "@cursor/sdk";

import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionChunkChoice,
  OpenAIChatCompletionUsage,
  OpenAIToolCall,
} from "./types.js";

export interface OpenAIChunkContext {
  readonly id: string;
  readonly model: string;
}

function chunkFromDelta(
  ctx: OpenAIChunkContext,
  delta: {
    role?: "assistant";
    content?: string | null;
    tool_calls?: readonly OpenAIToolCall[];
  },
  finishReason: OpenAIChatCompletionChunkChoice["finish_reason"] = null,
  usage?: OpenAIChatCompletionUsage,
): OpenAIChatCompletionChunk {
  const base: OpenAIChatCompletionChunk = {
    id: ctx.id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: ctx.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  if (usage !== undefined) {
    return { ...base, usage };
  }
  return base;
}

export function openingChunk(ctx: OpenAIChunkContext): OpenAIChatCompletionChunk {
  return chunkFromDelta(ctx, { role: "assistant", content: "" });
}

export function contentChunk(
  ctx: OpenAIChunkContext,
  content: string,
): OpenAIChatCompletionChunk {
  return chunkFromDelta(ctx, { content });
}

export function toolCallsDeltaChunk(
  ctx: OpenAIChunkContext,
  tool_calls: readonly OpenAIToolCall[],
): OpenAIChatCompletionChunk {
  return chunkFromDelta(ctx, { tool_calls: [...tool_calls] }, null);
}

export function terminalChunk(
  ctx: OpenAIChunkContext,
  finishReason: "stop" | "length" | "tool_calls",
  usage?: OpenAIChatCompletionUsage,
): OpenAIChatCompletionChunk {
  return chunkFromDelta(ctx, {}, finishReason, usage);
}

/** Format a single OpenAI SSE event payload. */
export function sseEvent(chunk: OpenAIChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";

export type BridgeStreamTerminalCode =
  | "stream_upstream_failure"
  | "stream_wall_clock_timeout"
  | "stream_client_disconnect";

export interface BridgeStreamErrorPayload {
  readonly object: "bridge.error";
  readonly error: {
    readonly code: BridgeStreamTerminalCode;
    readonly message: string;
    readonly error_id: string;
    readonly retryable: boolean;
    readonly request_id?: string;
  };
}

/** SSE heartbeat comment (`: …`) ignored by parsers but keeps proxies from idling sockets out mid-run. */
export function sseComment(text: string): string {
  const safe = text.replace(/\r?\n/g, " ").trimEnd();
  return `: ${safe}\n\n`;
}

function newStreamErrorId(): string {
  return `errs_${randomBytes(8).toString("hex")}`;
}

export function buildStreamTerminalError(chunk: Omit<BridgeStreamErrorPayload["error"], "error_id"> & {
  readonly error_id?: string;
}): BridgeStreamErrorPayload {
  return {
    object: "bridge.error",
    error: {
      ...chunk,
      error_id: chunk.error_id ?? newStreamErrorId(),
    },
  };
}

/** Final `data:` line before `[DONE]` for mid-stream fatalities (timeouts, disconnect propagation, Cursor loop errors). */
export function sseStreamTerminalErrorEnvelope(payload: BridgeStreamErrorPayload): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Map the SDK stream of `assistant` messages to incremental OpenAI content
 * deltas. The SDK emits whole assistant messages (possibly multiple turns
 * before terminal), each carrying `content: Array<TextBlock | ToolUseBlock>`.
 * We track the running text per stream and emit only the suffix as a delta
 * so OpenAI clients that concatenate `choices[0].delta.content` end up with
 * the same final string as a non-streaming response.
 *
 * Non-text content blocks (`tool_use`) from the Cursor SDK are still ignored;
 * v1.1 OpenAI tool_calls come from parsing assistant text (`OPENAI_COMPAT_TOOL_JSON`).
 */
export interface AssistantTextTracker {
  consume(msg: SDKMessage): string | undefined;
  /** Whatever assistant text has been observed so far (used as fallback). */
  current(): string;
}

export function createAssistantTextTracker(): AssistantTextTracker {
  let acc = "";
  return {
    consume(msg) {
      if (msg.type !== "assistant") return undefined;
      const blocks = msg.message.content;
      let full = "";
      for (const block of blocks) {
        if (block.type === "text") full += block.text;
      }
      if (full.length <= acc.length) {
        return undefined;
      }
      if (full.startsWith(acc)) {
        const delta = full.slice(acc.length);
        acc = full;
        return delta.length > 0 ? delta : undefined;
      }
      acc = full;
      return full;
    },
    current() {
      return acc;
    },
  };
}

/**
 * Pull the final assistant text from a `RunResult`, falling back to the
 * accumulator when `result.result` is not set.
 */
export function finalText(result: RunResult, tracker: AssistantTextTracker): string {
  if (result.result && result.result.length > 0) return result.result;
  return tracker.current();
}

