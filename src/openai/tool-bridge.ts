import { randomBytes } from "node:crypto";

import type { OpenAIChatToolDefinition, OpenAIToolCall } from "./types.js";

/** Token before JSON payload; model output must end with this token then `{"tool_calls":[...]}`. */
export const BRIDGE_TOOL_JSON_TOKEN = "OPENAI_COMPAT_TOOL_JSON ";

const TOKEN_BASE = "OPENAI_COMPAT_TOOL_JSON";

function toolChoiceInstruction(toolChoice: unknown, tokenLabel: string): string {
  if (toolChoice === undefined || toolChoice === null) return "";
  if (toolChoice === "none") {
    return `The client set tool_choice to none — do not append the ${tokenLabel} line; reply with natural language only.`;
  }
  if (toolChoice === "required") {
    return `The client set tool_choice to required — you must append exactly one ${tokenLabel} line with at least one tool call (use the registered tools below).`;
  }
  if (typeof toolChoice === "object" && !Array.isArray(toolChoice)) {
    const o = toolChoice as Record<string, unknown>;
    const type = o.type;
    const fn = o.function;
    if (type === "function" && fn && typeof fn === "object") {
      const name = (fn as { name?: string }).name;
      if (typeof name === "string" && name.length > 0) {
        return `The client requires a call to function "${name}" — use that exact name in ${tokenLabel}.`;
      }
    }
  }
  return "";
}

/**
 * Appended to the merged system prompt when the client sends OpenAI `tools`.
 * The Cursor SDK has no arbitrary function-registration API — HTTP clients that
 * need `tool_calls` in responses rely on this line protocol or on upstream proxy mode.
 */
export function buildOpenAiToolBridgeAppendage(
  tools: readonly OpenAIChatToolDefinition[],
  toolChoice: unknown,
): string {
  const tokenLabel = "OPENAI_COMPAT_TOOL_JSON";
  const choiceHint = toolChoiceInstruction(toolChoice, tokenLabel);
  const serialized = JSON.stringify(tools, null, 0);
  const names = collectToolNames(tools);
  const memoryExample =
    names.has("memory")
      ? `Example (memory): ${tokenLabel} {"tool_calls":[{"id":"call_mem","type":"function","function":{"name":"memory","arguments":"{\\"action\\":\\"add\\",\\"target\\":\\"user\\",\\"content\\":\\"…\\"}"}}]}`
      : "";
  return [
    "---",
    "OpenAI-compatible tools bridge (extension)",
    "IMPORTANT — registered client tools take precedence over Cursor SDK native tools (Shell, Grep, Read, patch, etc.).",
    "When you need any function from the tool list below, invoke it ONLY via the line protocol below — do NOT call Cursor SDK equivalents.",
    "The HTTP client executes registered tools client-side (memory, skill_view, terminal, patch, and similar). They only work when you emit OPENAI_COMPAT_TOOL_JSON.",
    "Do NOT claim client-registered tools are unavailable. If the function appears in the tool list, append the line protocol.",
    "When you want the HTTP client to execute a registered function, append one final line after user-visible text:",
    `Format: ${tokenLabel} <JSON object>`,
    'JSON shape: {"tool_calls":[{"id":"call_…","type":"function","function":{"name":"<name from list>","arguments":"<JSON string>"}}]}',
    "`arguments` must be a minified JSON string (OpenAI function calling), not a raw object.",
    `Use only names from the tool list. Omit the ${tokenLabel} line when no client-side tools are needed.`,
    "Do not wrap the JSON in markdown fences or code blocks — emit the raw line only.",
    "Clients that cannot rely on model-emitted lines should use BRIDGE_CHAT_UPSTREAM_MODE=tools instead.",
    choiceHint,
    memoryExample,
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

function extractBalancedJsonObject(candidate: string): string | null {
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

function locateTokenPayload(fullText: string): { visible: string; jsonCandidate: string } | null {
  const idx = fullText.lastIndexOf(TOKEN_BASE);
  if (idx === -1) return null;

  const visible = fullText.slice(0, idx).trimEnd();
  const remainder = fullText.slice(idx + TOKEN_BASE.length).trim();
  if (remainder.length === 0) return null;
  return { visible, jsonCandidate: remainder };
}

function parseToolJsonCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const balanced = extractBalancedJsonObject(candidate);
    if (balanced === null) return undefined;
    try {
      return JSON.parse(balanced) as unknown;
    } catch {
      return undefined;
    }
  }
}

/**
 * Parses assistant text for `OPENAI_COMPAT_TOOL_JSON` and validates tool names.
 */
export function parseBridgeToolJsonFromAssistantText(
  fullText: string,
  allowedNames: Set<string>,
): { content: string | null; tool_calls?: OpenAIToolCall[] } {
  const located = locateTokenPayload(fullText);
  if (located === null) {
    const t = fullText.trimEnd();
    return { content: t.length > 0 ? t : null };
  }

  const { visible, jsonCandidate } = located;
  const data = parseToolJsonCandidate(jsonCandidate);
  if (data === undefined) {
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
