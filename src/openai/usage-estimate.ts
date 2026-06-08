import type { ParsedChatCompletionRequest } from "./chat-normalize.js";
import { stringifyNormalizedContent } from "./chat-normalize.js";
import type { OpenAIChatCompletionUsage } from "./types.js";

/** ~4 chars/token — matches Hermes preflight heuristics for consistent context bars. */
export function estimateTextTokensRough(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

function messageTextForEstimate(
  msg: ParsedChatCompletionRequest["messages"][number],
): string {
  const base = stringifyNormalizedContent(msg.content);
  if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
    const serialized = JSON.stringify(msg.tool_calls);
    return `${base}\n${serialized}`;
  }
  if (msg.role === "tool" && msg.tool_call_id) {
    return `[tool call_id=${msg.tool_call_id}]\n${base}`;
  }
  return base;
}

function estimatePromptTokens(parsed: ParsedChatCompletionRequest): number {
  let total = 0;
  for (const msg of parsed.messages) {
    total += estimateTextTokensRough(messageTextForEstimate(msg));
    // Per-message framing overhead (role markers, JSON wrappers).
    total += 4;
  }
  if (parsed.tools && parsed.tools.length > 0) {
    total += estimateTextTokensRough(JSON.stringify(parsed.tools));
  }
  return total;
}

function assistantOutputText(assistant: {
  readonly content: string | null;
  readonly tool_calls?: readonly { readonly function?: { readonly name?: string; readonly arguments?: string } }[];
}): string {
  const parts: string[] = [];
  if (assistant.content) parts.push(assistant.content);
  if (assistant.tool_calls && assistant.tool_calls.length > 0) {
    parts.push(JSON.stringify(assistant.tool_calls));
  }
  return parts.join("\n");
}

/** Best-effort usage for clients (Hermes context bar) when Cursor SDK omits real counts. */
export function estimateChatCompletionUsage(
  parsed: ParsedChatCompletionRequest,
  assistant: {
    readonly content: string | null;
    readonly tool_calls?: readonly { readonly function?: { readonly name?: string; readonly arguments?: string } }[];
  },
): OpenAIChatCompletionUsage {
  const prompt_tokens = estimatePromptTokens(parsed);
  const completion_tokens = estimateTextTokensRough(assistantOutputText(assistant));
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
  };
}
