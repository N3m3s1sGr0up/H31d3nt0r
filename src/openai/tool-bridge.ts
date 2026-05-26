import { randomBytes } from "node:crypto";

import type { OpenAIChatToolDefinition, OpenAIToolCall } from "./types.js";

/** Token before JSON payload; model output must end with this token then `{"tool_calls":[...]}`. */
export const BRIDGE_TOOL_JSON_TOKEN = "HERMES_BRIDGE_TOOL_JSON ";

export function collectToolNames(
  tools: readonly OpenAIChatToolDefinition[] | undefined,
): Set<string> {
  const names = new Set<string>();
  if (!tools) return names;
  for (const t of tools) {
    if (t.type !== "function") continue;
    const n = t.function?.name;
    if (typeof n === "string" && n.length > 0) names.add(n);
  }
  return names;
}

function toolChoiceInstruction(toolChoice: unknown): string {
  if (toolChoice === undefined || toolChoice === null) return "";
  if (toolChoice === "none") {
    return "The client set tool_choice to none — do not append the HERMES_BRIDGE_TOOL_JSON line; reply with natural language only.";
  }
  if (toolChoice === "required") {
    return "The client set tool_choice to required — you must append exactly one HERMES_BRIDGE_TOOL_JSON line with at least one tool call (use the registered tools below).";
  }
  if (typeof toolChoice === "object" && !Array.isArray(toolChoice)) {
    const o = toolChoice as Record<string, unknown>;
    const type = o.type;
    const fn = o.function;
    if (type === "function" && fn && typeof fn === "object") {
      const name = (fn as { name?: string }).name;
      if (typeof name === "string" && name.length > 0) {
        return `The client requires a call to function "${name}" — use that exact name in HERMES_BRIDGE_TOOL_JSON.`;
      }
    }
  }
  return "";
}

/**
 * Appended to the merged system prompt when the client sends OpenAI `tools`.
 * Cursor SDK has no native arbitrary-function registration; Hermes executes tools after this bridge returns tool_calls.
 */
export function buildOpenAiToolBridgeAppendage(
  tools: readonly OpenAIChatToolDefinition[],
  toolChoice: unknown,
): string {
  const choiceHint = toolChoiceInstruction(toolChoice);
  const serialized = JSON.stringify(tools, null, 0);
  return [
    "---",
    "hermes-cursor-api v1.1 — OpenAI tools (client / Hermes)",
    "The HTTP client listed function tools below. Cursor runs with its own built-in tools; this block is for OpenAI-compatible round-trips.",
    "When you want the client (e.g. Hermes) to execute a registered function, append a single final line to your reply after any user-visible text:",
    "Line format: HERMES_BRIDGE_TOOL_JSON <JSON object>",
    'The JSON object must be: {"tool_calls":[{"id":"call_…","type":"function","function":{"name":"<exact name from list>","arguments":"<JSON string of args per OpenAI>"}}]}',
    "`arguments` must be a string containing minified JSON (OpenAI function calling), not a raw object.",
    "Use only `name` values that appear in the tool list. If you are not requesting client-side tools, omit the HERMES_BRIDGE_TOOL_JSON line entirely.",
    choiceHint,
    "",
    "Tool definitions (JSON):",
    serialized,
  ]
    .filter((s) => s.length > 0)
    .join("\n");
}

function normalizeCallId(id: unknown): string {
  if (typeof id === "string" && id.length > 0) return id;
  return `call_${randomBytes(8).toString("hex")}`;
}

function normalizeArguments(args: unknown): string {
  if (typeof args === "string") return args;
  if (args === undefined) return "{}";
  try {
    return JSON.stringify(args);
  } catch {
    return "{}";
  }
}

/**
 * Parses the assistant result for HERMES_BRIDGE_TOOL_JSON and validates tool names.
 */
export function parseBridgeToolJsonFromAssistantText(
  fullText: string,
  allowedNames: Set<string>,
): { content: string | null; tool_calls?: OpenAIToolCall[] } {
  const j = fullText.lastIndexOf(BRIDGE_TOOL_JSON_TOKEN);
  if (j === -1) {
    const t = fullText.trimEnd();
    return { content: t.length > 0 ? t : null };
  }

  const visible = fullText.slice(0, j).trimEnd();
  const rest = fullText.slice(j + BRIDGE_TOOL_JSON_TOKEN.length).trim();
  let data: unknown;
  try {
    data = JSON.parse(rest) as unknown;
  } catch {
    return { content: fullText.trimEnd().length > 0 ? fullText.trimEnd() : null };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { content: visible.length > 0 ? visible : null };
  }
  const rec = data as { tool_calls?: unknown };
  if (!Array.isArray(rec.tool_calls) || rec.tool_calls.length === 0) {
    return { content: visible.length > 0 ? visible : null };
  }

  const out: OpenAIToolCall[] = [];
  for (const tc of rec.tool_calls) {
    if (tc === null || typeof tc !== "object" || Array.isArray(tc)) continue;
    const t0 = tc as Record<string, unknown>;
    if (t0.type !== "function") continue;
    const fn = t0.function;
    if (fn === null || typeof fn !== "object" || Array.isArray(fn)) continue;
    const f = fn as Record<string, unknown>;
    const name = f.name;
    if (typeof name !== "string" || !allowedNames.has(name)) continue;
    out.push({
      id: normalizeCallId(t0.id),
      type: "function",
      function: {
        name,
        arguments: normalizeArguments(f.arguments),
      },
    });
  }

  if (out.length === 0) {
    return { content: visible.length > 0 ? visible : fullText.trimEnd() };
  }

  return {
    content: visible.length > 0 ? visible : null,
    tool_calls: out,
  };
}
