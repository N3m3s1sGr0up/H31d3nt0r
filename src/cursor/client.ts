import { Agent, Cursor } from "@cursor/sdk";
import type {
  McpServerConfig,
  ModelListItem,
  Run,
  RunResult,
  SDKAgent,
  SDKModel,
  SettingSource,
} from "@cursor/sdk";

import { buildOpenAiToolBridgeAppendage } from "../openai/tool-bridge.js";
import type { OpenAIChatToolDefinition, OpenAIToolCall } from "../openai/types.js";

import { buildBridgeSystemContext, prependBridgeContext } from "./bridge-context.js";
import { resolveModelAlias } from "./model-aliases.js";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
  readonly tool_calls?: readonly OpenAIToolCall[];
}

/** When set, injects OpenAI tool definitions and parses `OPENAI_COMPAT_TOOL_JSON` from Cursor output (v1.1). */
export interface OpenAiToolBridgeInput {
  readonly tools?: readonly OpenAIChatToolDefinition[];
  readonly toolChoice?: unknown;
}

export interface CursorClientOptions {
  readonly cursorApiKey: string;
  readonly workspaceCwd: string | readonly string[];
  readonly localSettingSources?: readonly SettingSource[];
  readonly agentMcpServers?: Readonly<Record<string, McpServerConfig>>;
}

export interface StreamingChatHandle {
  readonly agent: SDKAgent;
  readonly run: Run;
}

/**
 * Thin wrapper around the Cursor SDK. Chat traffic uses Cursor local runtime
 * with `workspaceCwd` and bridge context injected before each prompt.
 */
export class CursorClient {
  readonly #apiKey: string;
  readonly #cwd: string | readonly string[];
  readonly #bridgePaths: {
    readonly repoRoot: string;
    readonly extraWorkspaceRoot?: string;
  };
  readonly #settingSources: readonly SettingSource[];
  readonly #mcpServers: Readonly<Record<string, McpServerConfig>> | undefined;

  constructor(options: CursorClientOptions) {
    this.#apiKey = options.cursorApiKey;
    this.#cwd = options.workspaceCwd;
    const cwd = options.workspaceCwd;
    const repoRoot = typeof cwd === "string" ? cwd : (cwd[0] ?? "");
    const extraWorkspace =
      typeof cwd === "string"
        ? undefined
        : cwd.length > 1
          ? cwd[1]
          : undefined;
    this.#bridgePaths = {
      repoRoot,
      extraWorkspaceRoot: extraWorkspace,
    };
    this.#settingSources = options.localSettingSources ?? ["project", "user"];
    this.#mcpServers = options.agentMcpServers;
  }

  #localOptions(
    cwdOverride?: string | readonly string[],
  ): { cwd: string | string[]; settingSources: SettingSource[] } {
    const base = cwdOverride ?? this.#cwd;
    const cwd: string | string[] = typeof base === "string" ? base : [...base];
    return {
      cwd,
      settingSources: [...this.#settingSources],
    };
  }

  #agentOptionsTail(): Partial<{
    readonly mcpServers: Readonly<Record<string, McpServerConfig>>;
  }> {
    if (this.#mcpServers === undefined || Object.keys(this.#mcpServers).length === 0) {
      return {};
    }
    return { mcpServers: this.#mcpServers };
  }

  #prepareMessages(
    messages: ChatMessage[],
    bridge?: OpenAiToolBridgeInput,
  ): ChatMessage[] {
    const hasClientTools = Boolean(bridge?.tools && bridge.tools.length > 0);
    const context = buildBridgeSystemContext(this.#bridgePaths, {
      clientToolsRegistered: hasClientTools,
    });
    return prependBridgeContext(messages, context);
  }

  #appendToolBridge(
    messages: ChatMessage[],
    bridge: OpenAiToolBridgeInput | undefined,
  ): ChatMessage[] {
    if (!bridge?.tools || bridge.tools.length === 0) return messages;
    const append = buildOpenAiToolBridgeAppendage(bridge.tools, bridge.toolChoice);
    const out = [...messages];
    const head = out[0];
    if (head?.role === "system") {
      out[0] = { ...head, content: `${head.content}\n\n${append}` };
    } else {
      out.unshift({ role: "system", content: append });
    }
    return out;
  }

  /** `Cursor.models.list({ apiKey })` — proxied for `/v1/models`. */
  async listModels(): Promise<SDKModel[]> {
    return Cursor.models.list({ apiKey: this.#apiKey });
  }

  /** OpenAI-style non-streaming chat completion → final assistant text. */
  async chatComplete(
    messages: ChatMessage[],
    modelId: string,
    bridge?: OpenAiToolBridgeInput,
    cwdOverride?: string | readonly string[],
  ): Promise<RunResult> {
    const prepared0 = this.#prepareMessages(messages, bridge);
    const prepared = this.#appendToolBridge(prepared0, bridge);
    return Agent.prompt(messagesToPrompt(prepared), {
      apiKey: this.#apiKey,
      model: { id: normalizeCursorModelId(modelId) },
      local: this.#localOptions(cwdOverride),
      ...this.#agentOptionsTail(),
    });
  }

  /**
   * Open a streaming run. The caller iterates `run.stream()` and must call
   * `await run.wait()` for the terminal status, then dispose the agent in a
   * `finally` block. If `agent.send(...)` throws, this helper disposes for
   * the caller.
   */
  async openStreamingChat(
    messages: ChatMessage[],
    modelId: string,
    bridge?: OpenAiToolBridgeInput,
    cwdOverride?: string | readonly string[],
  ): Promise<StreamingChatHandle> {
    const prepared0 = this.#prepareMessages(messages, bridge);
    const prepared = this.#appendToolBridge(prepared0, bridge);
    const agent = await Agent.create({
      apiKey: this.#apiKey,
      model: { id: normalizeCursorModelId(modelId) },
      local: this.#localOptions(cwdOverride),
      ...this.#agentOptionsTail(),
    });
    try {
      const run = await agent.send(messagesToPrompt(prepared));
      return { agent, run };
    } catch (err) {
      await agent[Symbol.asyncDispose]();
      throw err;
    }
  }
}

/** Strip optional `cursor/` or `cursor:` prefix, then resolve known typo aliases. */
export function normalizeCursorModelId(model: string): string {
  let id = model;
  if (id.startsWith("cursor/")) id = id.slice("cursor/".length);
  else if (id.startsWith("cursor:")) id = id.slice("cursor:".length);
  return resolveModelAlias(id);
}

/**
 * Flatten OpenAI chat messages into a single prompt string. The Cursor SDK
 * takes a single prompt; the gateway composes turns with explicit role labels
 * so the agent can read the conversation deterministically.
 */
export function messagesToPrompt(messages: ChatMessage[]): string {
  const systems = messages.filter((m) => m.role === "system").map((m) => m.content);
  const turns = messages.filter((m) => m.role !== "system");

  const parts: string[] = [];
  if (systems.length > 0) {
    parts.push(`[system]\n${systems.join("\n\n").trim()}`);
  }
  for (const message of turns) {
    const label = message.role === "user" ? "[user]" : "[assistant]";
    let body = message.content.trim();
    if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
      body += `\n[OpenAI tool_calls in prior turn]\n${JSON.stringify(message.tool_calls)}`;
    }
    parts.push(`${label}\n${body}`);
  }
  return parts.join("\n\n");
}

export type { ModelListItem, Run, RunResult, SDKAgent, SDKModel };
