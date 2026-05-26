/**
 * Validates OpenAI-style chat payloads and prepares bridge / upstream payloads.
 */

import type { ChatMessage } from "../cursor/client.js";
import type { OpenAIChatToolDefinition, OpenAIToolCall } from "./types.js";

export type NormalizedChatRole = "system" | "developer" | "user" | "assistant" | "tool";

export type NormalizedChatContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

/** After validation: string or multimodal segments for upstream fidelity. */
export type NormalizedMessageContent = string | readonly NormalizedChatContentPart[];

export interface NormalizedChatMessage {
  readonly role: NormalizedChatRole;
  readonly content: NormalizedMessageContent;
  readonly tool_calls?: readonly OpenAIToolCall[];
  readonly tool_call_id?: string;
}

export interface ParsedChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly NormalizedChatMessage[];
  readonly stream: boolean;
  readonly tools?: readonly OpenAIChatToolDefinition[];
  readonly tool_choice?: unknown;
  readonly stream_options?: { readonly include_usage?: boolean };
  /** Extra keys to forward verbatim to upstream OpenAI-compatible APIs. */
  readonly upstreamExtras: Readonly<Record<string, unknown>>;
}

const ALLOWED_MERGE_KEYS = new Set([
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "max_tokens",
  "max_completion_tokens",
  "n",
  "stop",
  "user",
  "seed",
  "logit_bias",
  "response_format",
  "logprobs",
  "top_logprobs",
  "modalities",
]);

function normalizeContentPiece(
  part: Record<string, unknown>,
  idx: number,
  path: string,
):
  | { ok: false; message: string }
  | {
      ok: true;
      part: NormalizedChatContentPart;
    } {
  const t = part.type;
  if (t === "text") {
    const text = typeof part.text === "string" ? part.text : null;
    if (text === null) {
      return { ok: false, message: `${path}[${idx}].text must be a string.` };
    }
    return { ok: true, part: { type: "text", text } };
  }
  if (t === "image_url") {
    const iu = part.image_url;
    if (!iu || typeof iu !== "object" || Array.isArray(iu)) {
      return { ok: false, message: `${path}[${idx}].image_url must be an object.` };
    }
    const r = iu as Record<string, unknown>;
    if (typeof r.url !== "string" || r.url.length === 0) {
      return { ok: false, message: `${path}[${idx}].image_url.url must be a non-empty string.` };
    }
    return { ok: true, part: { type: "image_url", image_url: { url: r.url } } };
  }
  return { ok: false, message: `${path}[${idx}].type must be \"text\" or \"image_url\".` };
}

function normalizeContent(
  rawContent: unknown,
  path: string,
): { ok: false; message: string } | { ok: true; content: NormalizedMessageContent } {
  if (rawContent === null) {
    return { ok: true, content: "" };
  }
  if (typeof rawContent === "string") {
    return { ok: true, content: rawContent };
  }
  if (!Array.isArray(rawContent)) {
    return { ok: false, message: `${path} must be a string, null, or non-empty parts array.` };
  }
  if (rawContent.length === 0) {
    return { ok: false, message: `${path} parts array cannot be empty.` };
  }
  const out: NormalizedChatContentPart[] = [];
  for (let i = 0; i < rawContent.length; i += 1) {
    const el = rawContent[i];
    if (!el || typeof el !== "object" || Array.isArray(el)) {
      return { ok: false, message: `${path}[${i}] must be an object.` };
    }
    const normalized = normalizeContentPiece(el as Record<string, unknown>, i, path);
    if (!normalized.ok) {
      return { ok: false, message: normalized.message };
    }
    out.push(normalized.part);
  }
  return { ok: true, content: out };
}

function parseInlineToolCalls(value: unknown): OpenAIToolCall[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OpenAIToolCall[] = [];
  for (const el of value) {
    if (!el || typeof el !== "object" || Array.isArray(el)) continue;
    const o = el as Record<string, unknown>;
    if (o.type !== "function") continue;
    const fn = o.function;
    if (!fn || typeof fn !== "object" || Array.isArray(fn)) continue;
    const f = fn as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof f.name !== "string") continue;
    const argsRaw = f.arguments;
    const args =
      typeof argsRaw === "string"
        ? argsRaw
        : argsRaw === undefined
          ? "{}"
          : JSON.stringify(argsRaw);
    out.push({ id: o.id, type: "function", function: { name: f.name, arguments: args } });
  }
  return out.length > 0 ? out : undefined;
}

function pickUpstreamExtras(raw: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_MERGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      const v = raw[key];
      if (v !== undefined) out[key] = v;
    }
  }
  return out;
}

function roleFromInput(role: string): NormalizedChatRole | undefined {
  if (role === "system") return "system";
  if (role === "developer") return "developer";
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "tool") return "tool";
  return undefined;
}

/** Flatten normalized content into a Cursor prompt-friendly string (images described). */
export function stringifyNormalizedContent(content: NormalizedMessageContent): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const p of content) {
    if (p.type === "text") {
      parts.push(p.text);
    } else if (p.type === "image_url") {
      const u = p.image_url.url;
      const clipped = u.length > 240 ? `${u.slice(0, 240)}…` : u;
      parts.push(`[image attachment: ${clipped}]`);
    }
  }
  return parts.join("\n").trimEnd();
}

/**
 * Converts normalized OpenAI messages into bridge messages for the Cursor SDK
 * flattening pass.
 */
export function normalizedToBridgeMessages(messages: readonly NormalizedChatMessage[]): ChatMessage[] {
  return messages.map((m): ChatMessage => {
    if (m.role === "tool") {
      const id = m.tool_call_id ?? "unknown";
      return {
        role: "assistant",
        content: `[tool call_id=${id}]\n${stringifyNormalizedContent(m.content)}`,
      };
    }
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: stringifyNormalizedContent(m.content),
        tool_calls: m.tool_calls,
      };
    }
    if (m.role === "developer") {
      return { role: "system", content: `[developer]\n${stringifyNormalizedContent(m.content)}` };
    }
    return {
      role: m.role === "system" ? "system" : m.role === "user" ? "user" : "assistant",
      content: stringifyNormalizedContent(m.content),
    };
  });
}

/** JSON-serialize messages exactly as normalized (developer role preserved upstream). */
function messagesJsonForUpstream(messages: readonly NormalizedChatMessage[]): unknown[] {
  return messages.map((m) => {
    const row: Record<string, unknown> = {
      role: m.role,
      content: m.content,
    };
    if (m.role === "tool" && m.tool_call_id !== undefined) {
      row.tool_call_id = m.tool_call_id;
    }
    if (m.role === "assistant" && m.tool_calls !== undefined && m.tool_calls.length > 0) {
      row.tool_calls = m.tool_calls.map((tc) => ({ ...tc }));
    }
    return row;
  });
}

export function buildUpstreamChatJson(body: ParsedChatCompletionRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...body.upstreamExtras,
    model: body.model,
    messages: messagesJsonForUpstream(body.messages),
    stream: body.stream,
  };
  if (body.tools !== undefined && body.tools.length > 0) {
    out.tools = body.tools.map((t) => ({ ...(t as object) })) as unknown;
    if (body.tool_choice !== undefined) out.tool_choice = body.tool_choice;
  }
  if (body.stream_options !== undefined && Object.keys(body.stream_options).length > 0) {
    out.stream_options = body.stream_options;
  }
  return out;
}

export type ParseChatCompletionResult =
  | { readonly ok: true; readonly body: ParsedChatCompletionRequest }
  | { readonly ok: false; readonly message: string };

export function parseChatCompletionBody(raw: unknown): ParseChatCompletionResult {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const obj = raw as Record<string, unknown>;

  const upstreamExtras = pickUpstreamExtras(obj);

  if (typeof obj.model !== "string" || obj.model.length === 0) {
    return { ok: false, message: "`model` is required and must be a non-empty string." };
  }

  const streamOptions =
    typeof obj.stream_options === "object" &&
    obj.stream_options !== null &&
    !Array.isArray(obj.stream_options)
      ? (obj.stream_options as { include_usage?: boolean })
      : undefined;

  const stream = typeof obj.stream === "boolean" ? obj.stream : false;

  if (!Array.isArray(obj.messages) || obj.messages.length === 0) {
    return { ok: false, message: "`messages` is required and must be a non-empty array." };
  }

  const messages: NormalizedChatMessage[] = [];
  for (let i = 0; i < obj.messages.length; i += 1) {
    const m = obj.messages[i] as Record<string, unknown> | null;
    if (m === null || typeof m !== "object") {
      return { ok: false, message: `messages[${i}] must be an object.` };
    }
    const rawRole = m.role;
    if (typeof rawRole !== "string") {
      return { ok: false, message: `messages[${i}].role must be a string.` };
    }
    const nr = roleFromInput(rawRole);
    if (!nr) {
      return {
        ok: false,
        message:
          `messages[${i}].role must be system|developer|user|assistant|tool.`,
      };
    }

    const contentRes = normalizeContent(m.content ?? null, `messages[${i}].content`);
    if (!contentRes.ok) {
      return contentRes;
    }

    if (nr === "tool") {
      const tid = m.tool_call_id;
      if (typeof tid !== "string" || tid.length === 0) {
        return {
          ok: false,
          message: `messages[${i}] (tool role) requires non-empty tool_call_id.`,
        };
      }
      messages.push({ role: "tool", content: contentRes.content, tool_call_id: tid });
      continue;
    }

    if (nr === "assistant") {
      const tc = parseInlineToolCalls(m.tool_calls);
      const literal = stringifyNormalizedContent(contentRes.content);
      if (literal.length === 0 && (!tc || tc.length === 0)) {
        return {
          ok: false,
          message: `messages[${i}] must include non-empty content and/or tool_calls.`,
        };
      }
      messages.push({
        role: "assistant",
        content: contentRes.content,
        ...(tc ? { tool_calls: tc } : {}),
      });
      continue;
    }

    if (nr === "user" || nr === "system" || nr === "developer") {
      messages.push({
        role: nr,
        content: contentRes.content,
      });
      continue;
    }

    return { ok: false, message: `messages[${i}] role not implemented.` };
  }

  const toolsRaw = Array.isArray(obj.tools) ? (obj.tools as OpenAIChatToolDefinition[]) : undefined;

  return {
    ok: true,
    body: {
      model: obj.model,
      messages,
      stream,
      tools:
        toolsRaw !== undefined && toolsRaw.length > 0
          ? toolsRaw.map((t) => ({ ...(t as object) })) as OpenAIChatToolDefinition[]
          : undefined,
      tool_choice: obj.tool_choice,
      stream_options: streamOptions,
      upstreamExtras,
    },
  };
}
