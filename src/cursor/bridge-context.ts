import type { OpenAIToolCall } from "../openai/types.js";

/**
 * Injected into every Cursor run so the model does not claim it lacks host access.
 * OpenAI `tools` from the HTTP client are merged separately (see `tool-bridge.ts`).
 */
export function buildBridgeSystemContext(paths: {
  readonly repoRoot: string;
  readonly extraWorkspaceRoot?: string;
}): string {
  const lines = [
    "You are running on the operator's machine through an OpenAI-compatible HTTP gateway that executes work via the Cursor SDK local runtime.",
    "When the SDK exposes filesystem and terminal tools, you can use them on the declared workspace directories — do not claim you lack access unless a tool genuinely fails.",
    "",
    "Important paths:",
    `- Primary workspace: ${paths.repoRoot}`,
  ];
  if (paths.extraWorkspaceRoot !== undefined && paths.extraWorkspaceRoot.length > 0) {
    lines.push(`- Additional workspace: ${paths.extraWorkspaceRoot}`);
  }
  lines.push(
    "",
    "Follow the end-user instructions for each request. Persist data only where the user (or upstream client) directs you.",
  );
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
