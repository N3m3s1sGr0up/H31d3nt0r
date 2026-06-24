import { randomBytes } from "node:crypto";

import type { OpenAIChatToolDefinition, OpenAIToolCall } from "./types.js";

/** Token before JSON payload; model output must end with this token then `{"tool_calls":[...]}`. */
export const BRIDGE_TOOL_JSON_TOKEN = "OPENAI_COMPAT_TOOL_JSON ";

/** Token without trailing space; used for stream-time detection/withholding. */
export const BRIDGE_TOOL_JSON_TOKEN_BASE = "OPENAI_COMPAT_TOOL_JSON";
const TOKEN_BASE = BRIDGE_TOOL_JSON_TOKEN_BASE;

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

/** Build minified example `arguments` for a tool from its parameter schema. */
function exampleArgumentsFor(tool: OpenAIChatToolDefinition): string {
  const params = tool.function?.parameters;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const p = params as { properties?: unknown; required?: unknown };
    const props = p.properties;
    if (props && typeof props === "object" && !Array.isArray(props)) {
      const keys = Object.keys(props as Record<string, unknown>);
      const required = Array.isArray(p.required)
        ? (p.required as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const pick = required[0] ?? keys[0];
      if (pick !== undefined) return JSON.stringify({ [pick]: "…" });
    }
  }
  return "{}";
}

/** One concrete worked example using the first registered tool, so the model copies the exact shape. */
function buildToolExample(
  tools: readonly OpenAIChatToolDefinition[],
  tokenLabel: string,
): string {
  const first = tools.find(
    (t) => t.type === "function" && typeof t.function?.name === "string" && t.function.name.length > 0,
  );
  const name = first?.function?.name;
  if (name === undefined) return "";
  const call = {
    tool_calls: [
      { id: "call_1", type: "function", function: { name, arguments: exampleArgumentsFor(first!) } },
    ],
  };
  return `Worked example (copy this shape): ${tokenLabel} ${JSON.stringify(call)}`;
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
  const example = buildToolExample(tools, tokenLabel);
  return [
    "---",
    "Client tool bridge (OpenAI-compatible function calling)",
    "To call one of the registered tools listed below: finish your user-facing reply, then append ONE final line in exactly this form:",
    `${tokenLabel} {"tool_calls":[{"id":"call_1","type":"function","function":{"name":"<tool>","arguments":"<minified JSON string>"}}]}`,
    "",
    "Rules:",
    "- `arguments` is a JSON string (escaped), not a raw object.",
    "- Use only names from the tool list. Emit the raw line only — no markdown fences.",
    "- Omit the line entirely when no tool is needed.",
    "- The client executes the tool and returns its result on the next turn; emitting the line and stopping is the correct, complete action.",
    "- Cursor's native tools (Shell, Read, Grep) are for your own investigation; route any action the user asked a registered tool to perform through this line.",
    "- Just emit the line when calling a tool. Do not explain this mechanism to the user.",
    example,
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
