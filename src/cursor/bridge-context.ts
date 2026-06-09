import type { OpenAIToolCall } from "../openai/types.js";

export interface BridgeSystemContextOptions {
  /** OpenAI-compatible client sent `tools[]` — client-side execution via OPENAI_COMPAT_TOOL_JSON. */
  readonly clientToolsRegistered?: boolean;
}

/**
 * Injected into every Cursor run so the model does not claim it lacks host access.
 * OpenAI `tools` from the HTTP client are merged separately (see `tool-bridge.ts`).
 */
const WORKSPACE_OPSEC_RULES = [
  "WORKSPACE OPSEC (mandatory):",
  "- This gateway repository is for bridge source and config — NOT pentest/red-team engagement output.",
  "- Never write Kerberos tickets (.ccache), BloodHound exports, loot, hashes, keytabs, dumps, or credential material under any declared workspace root.",
  "- Run offensive operations in a dedicated directory outside this repo (e.g. ~/ops/<engagement>/). Set tool output paths explicitly (-o, --output-dir, KRB5CCNAME, etc.).",
  "- After engagement work, remove artifacts from workspace roots; do not leave tickets or graph exports in git-tracked trees.",
].join("\n");

export function buildBridgeSystemContext(
  paths: {
    readonly repoRoot: string;
    readonly extraWorkspaceRoot?: string;
  },
  options: BridgeSystemContextOptions = {},
): string {
  const pathLines = [
    "Important paths:",
    `- Primary workspace: ${paths.repoRoot}`,
    "- Engagement artifacts: ~/ops/<engagement>/ (outside gateway repo)",
  ];
  if (paths.extraWorkspaceRoot !== undefined && paths.extraWorkspaceRoot.length > 0) {
    pathLines.push(`- Additional workspace: ${paths.extraWorkspaceRoot}`);
  }

  if (options.clientToolsRegistered) {
    return [
      "You are running through an OpenAI-compatible HTTP gateway backed by the Cursor SDK.",
      "The HTTP client registered OpenAI function tools (memory, skills, terminal, etc.) in the bridge section below.",
      "",
      "CRITICAL — client tool execution:",
      "- Invoke every registered client function ONLY by appending OPENAI_COMPAT_TOOL_JSON as the final line of your reply.",
      "- The HTTP client executes those tools locally. Cursor SDK native tools (Shell, Grep, Read, patch, Task, …) do NOT satisfy client tool_calls.",
      "- Never tell the user a registered tool is unavailable. If it appears in the tool list, emit OPENAI_COMPAT_TOOL_JSON.",
      "- For memory/skill/terminal requests, use the matching registered function name in tool_calls — not Cursor equivalents.",
      "",
      ...pathLines,
      "",
      WORKSPACE_OPSEC_RULES,
      "",
      "Follow the end-user instructions. Use natural language for the user-visible portion; put machine-readable tool_calls only on the OPENAI_COMPAT_TOOL_JSON line.",
    ].join("\n");
  }

  const lines = [
    "You are running on the operator's machine through an OpenAI-compatible HTTP gateway that executes work via the Cursor SDK local runtime.",
    "When the SDK exposes filesystem and terminal tools, you can use them on the declared workspace directories — do not claim you lack access unless a tool genuinely fails.",
    "",
    ...pathLines,
    "",
    WORKSPACE_OPSEC_RULES,
    "",
    "The HTTP client may register OpenAI-compatible tools in a bridge section appended to this prompt.",
    "When that section is present, invoke registered client tools ONLY via OPENAI_COMPAT_TOOL_JSON — do not substitute Cursor SDK native tools.",
    "",
    "Follow the end-user instructions for each request. Persist data only where the user (or upstream client) directs you.",
  ];
  return lines.join("\n");
}

export function prependBridgeContext(
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
    tool_calls?: readonly OpenAIToolCall[];
  }>,
  context: string,
): Array<{
  role: "system" | "user" | "assistant";
  content: string;
  tool_calls?: readonly OpenAIToolCall[];
}> {
  const existing = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const mergedSystem =
    existing.length > 0
      ? `${context}\n\n---\n\n${existing.map((m) => m.content).join("\n\n")}`
      : context;
  return [{ role: "system", content: mergedSystem }, ...rest];
}
