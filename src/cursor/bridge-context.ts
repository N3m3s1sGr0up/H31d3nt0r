import type { OpenAIToolCall } from "../openai/types.js";

/**
 * Injected into every Cursor run so the model does not claim it lacks host access.
 * OpenAI `tools` from the HTTP client are forwarded as system text (v1.1) for Hermes tool round-trips.
 */
export function buildBridgeSystemContext(paths: {
  readonly repoRoot: string;
  readonly hermesHome: string;
}): string {
  return [
    "You are running on the operator's machine via the hermes-cursor-api bridge (Cursor SDK local runtime).",
    "You have real access to the filesystem and shell through Cursor tools — do not say you cannot work on this computer.",
    "",
    "Important paths:",
    `- Project repository: ${paths.repoRoot}`,
    `- Hermes home: ${paths.hermesHome}`,
    `- Persona (SOUL): ${paths.hermesHome}/SOUL.md — edit this file when the user asks to change your name, tone, or persona.`,
    `- Hermes memory files: ${paths.hermesHome}/memories/MEMORY.md and ${paths.hermesHome}/memories/USER.md — update these when the user asks you to remember something durable.`,
    `- Hermes config: ${paths.hermesHome}/config.yaml (read-only unless the user explicitly asks to change Hermes settings).`,
    "",
    `Compound Engineering (EveryInc) skills — on-disk copies Hermes loads as category compound-engineering:`,
    `- Directory: ${paths.hermesHome}/skills/compound-engineering/<skill-name>/SKILL.md`,
    `- When planning, structured implementation, brainstorms, PR/commit flows, reviews, or other CE workflows fit the task, read the matching SKILL.md with Cursor file tools (and linked references/ under that skill) before improvising.`,
    `- Common entrypoints: ce-plan, ce-work, ce-work-beta, ce-brainstorm, ce-setup, ce-code-review, ce-commit-push-pr.`,
    `- Same catalog appears in Hermes as \`hermes skills list\` (compound-engineering); this path is authoritative for Cursor runs.`,
    "",
    "When the user asks to update soul, memory, or project files, use Cursor file and terminal tools to make the change, then confirm what you changed.",
  ].join("\n");
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
