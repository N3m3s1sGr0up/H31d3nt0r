import { randomBytes } from "node:crypto";

import type { RunResult, SDKMessage } from "@cursor/sdk";

import { BRIDGE_TOOL_JSON_TOKEN_BASE } from "./tool-bridge.js";
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

/**
 * Live progress tracker for the tool-bridge streaming path.
 *
 * When the request carries OpenAI `tools`, the gateway cannot stream raw
 * assistant text blindly: the final answer may end with an
 * `OPENAI_COMPAT_TOOL_JSON {…}` line that must be stripped and converted to
 * `tool_calls`. Historically that forced full buffering (no output until the
 * Cursor run finished). This tracker restores visibility by emitting, as they
 * arrive:
 *   - `thinking` text (reasoning),
 *   - `tool_call` lifecycle lines (Cursor's own Shell/Read/Grep/etc. usage),
 *   - assistant answer text, while withholding a short tail so a forming
 *     `OPENAI_COMPAT_TOOL_JSON` token is never leaked to the client.
 *
 * Returned strings are pre-formatted content fragments (with channel
 * separators) ready to drop into a `delta.content` chunk. The final answer
 * remainder + parsed `tool_calls` are still emitted by the caller at finalize.
 */
export interface StreamProgressTracker {
  /**
   * Content fragments to emit for this SDK message. OpenAI clients concatenate
   * `delta.content` verbatim, so fragments preserve the model's exact spacing
   * and newlines; channel headers (💭 / tool lines) carry their own newlines.
   */
  consume(msg: SDKMessage): string[];
  /** Remaining answer text (token line stripped) to flush at finalize. */
  drainFinalAnswer(): string[];
  /** Full accumulated raw assistant answer text (token line included). */
  answerText(): string;
}

type ProgressKind = "thinking" | "tool" | "answer";

/**
 * Fold an SDK text update into an accumulator, returning the new suffix to emit.
 * Works whether the SDK sends cumulative snapshots (`full` extends `acc`) or
 * incremental deltas (`full` is just the new piece) — without inserting any
 * spurious whitespace between pieces.
 */
function advanceText(acc: string, full: string): { acc: string; delta: string } {
  if (full.length === 0) return { acc, delta: "" };
  if (full.startsWith(acc)) return { acc: full, delta: full.slice(acc.length) };
  return { acc: acc + full, delta: full };
}

/** Best-effort short hint from a tool's arguments (e.g. the path it read). */
const TOOL_ARG_HINT_KEYS = [
  "path",
  "file",
  "file_path",
  "filePath",
  "target_file",
  "pattern",
  "query",
  "command",
  "cmd",
  "url",
  "name",
] as const;

function toolArgHint(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const rec = args as Record<string, unknown>;
  for (const key of TOOL_ARG_HINT_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v.trim().length > 0) {
      const one = v.replace(/\s+/g, " ").trim();
      return one.length > 60 ? `${one.slice(0, 57)}…` : one;
    }
  }
  return "";
}

function toolLine(cls: "active" | "error", name: string, args: unknown): string {
  const hint = toolArgHint(args);
  const glyph = cls === "error" ? "✗" : "⚙";
  const suffix = cls === "error" ? " (failed)" : "";
  return `${glyph} ${name}${hint ? ` ${hint}` : ""}${suffix}`;
}

export function createStreamProgressTracker(): StreamProgressTracker {
  const token = BRIDGE_TOOL_JSON_TOKEN_BASE;
  let answerAcc = "";
  let answerEmitted = 0;
  let tokenSeen = false;
  let thinkingAcc = "";
  let thinkingStarted = false;
  const toolSeen = new Map<string, "active" | "error">();
  let lastKind: ProgressKind | undefined;
  let started = false;
  let atLineStart = true;

  // Push one fragment, inserting a blank separator line when switching channels
  // so reasoning / tool lines / answer text stay visually distinct.
  const emit = (out: string[], kind: ProgressKind, text: string): void => {
    if (text.length === 0) return;
    let prefix = "";
    if (started && kind !== lastKind) {
      prefix = atLineStart ? "\n" : "\n\n";
    }
    const piece = prefix + text;
    out.push(piece);
    started = true;
    lastKind = kind;
    atLineStart = piece.endsWith("\n");
  };

  // Boundary up to which `answerAcc` is safe to reveal: never past a forming
  // OPENAI_COMPAT_TOOL_JSON sentinel. Only withholds a genuine token-prefix
  // suffix, so ordinary prose streams in full (no dropped trailing words).
  const safeBoundary = (atEnd: boolean): number => {
    if (tokenSeen) return -1;
    const idx = answerAcc.indexOf(token);
    if (idx >= 0) {
      tokenSeen = true;
      return idx;
    }
    if (atEnd) return answerAcc.length;
    const max = Math.min(token.length - 1, answerAcc.length);
    for (let k = max; k > 0; k -= 1) {
      if (answerAcc.endsWith(token.slice(0, k))) return answerAcc.length - k;
    }
    return answerAcc.length;
  };

  // Reveal answer text up to the safe boundary, verbatim (spaces + newlines).
  const drainAnswer = (out: string[], atEnd: boolean): void => {
    const bound = safeBoundary(atEnd);
    if (bound < 0 || bound <= answerEmitted) return;
    const chunk = answerAcc.slice(answerEmitted, bound);
    answerEmitted = bound;
    emit(out, "answer", chunk);
  };

  const noteTool = (out: string[], key: string, cls: "active" | "error", name: string, args: unknown): void => {
    const prev = toolSeen.get(key);
    if (cls === "active" && prev === undefined) {
      toolSeen.set(key, "active");
      emit(out, "tool", `${toolLine("active", name, args)}\n`);
    } else if (cls === "error" && prev !== "error") {
      toolSeen.set(key, "error");
      emit(out, "tool", `${toolLine("error", name, args)}\n`);
    }
  };

  return {
    consume(msg) {
      const out: string[] = [];
      if (msg.type === "assistant") {
        let full = "";
        for (const block of msg.message.content) {
          if (block.type === "text") full += block.text;
        }
        answerAcc = advanceText(answerAcc, full).acc;
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            noteTool(out, `use:${block.id}`, "active", block.name, block.input);
          }
        }
        drainAnswer(out, false);
      } else if (msg.type === "thinking") {
        const { acc, delta } = advanceText(thinkingAcc, msg.text ?? "");
        thinkingAcc = acc;
        if (delta.length > 0) {
          const header = thinkingStarted ? "" : "💭 ";
          thinkingStarted = true;
          emit(out, "thinking", header + delta);
        }
      } else if (msg.type === "tool_call") {
        const cls = msg.status === "error" ? "error" : "active";
        noteTool(out, msg.call_id, cls, msg.name, msg.args);
      }
      return out;
    },
    drainFinalAnswer() {
      const out: string[] = [];
      drainAnswer(out, true);
      return out;
    },
    answerText() {
      return answerAcc;
    },
  };
}

