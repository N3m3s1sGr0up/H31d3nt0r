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

import {
  buildOpenAiToolBridgeAppendage,
} from "../openai/tool-bridge.js";
import type { OpenAIChatToolDefinition, OpenAIToolCall } from "../openai/types.js";

import { buildBridgeSystemContext, prependBridgeContext } from "./bridge-context.js";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
  readonly tool_calls?: readonly OpenAIToolCall[];
}

/** When set, the bridge injects OpenAI tool definitions and parses `HERMES_BRIDGE_TOOL_JSON` from Cursor output (v1.1). */
export interface OpenAiToolBridgeInput {
  readonly tools?: readonly OpenAIChatToolDefinition[];
  readonly toolChoice?: unknown;
}

export interface CursorClientOptions {
  readonly cursorApiKey: string;
  readonly workspaceCwd: string | readonly string[];
  readonly hermesHomeDir: string;
  readonly localSettingSources?: readonly SettingSource[];
  readonly agentMcpServers?: Readonly<Record<string, McpServerConfig>>;
}

export interface StreamingChatHandle {
  readonly agent: SDKAgent;
  readonly run: Run;
}

/**
 * Thin wrapper around the Cursor SDK. All Hermes traffic uses Cursor local
 * runtime with repo + ~/.hermes on the cwd path and bridge context injected.
 */
export class CursorClient {
  readonly #apiKey: string;
  readonly #cwd: string | readonly string[];
  readonly #bridgeContext: string;
  readonly #settingSources: readonly SettingSource[];
  readonly #mcpServers: Readonly<Record<string, McpServerConfig>> | undefined;

  constructor(options: CursorClientOptions) {
    this.#apiKey = options.cursorApiKey;
    this.#cwd = options.workspaceCwd;
    const repoRoot = Array.isArray(options.workspaceCwd)
      ? options.workspaceCwd[0] ?? options.hermesHomeDir
      : options.workspaceCwd;
    this.#bridgeContext = buildBridgeSystemContext({
      repoRoot,
      hermesHome: options.hermesHomeDir,
    });
    this.#settingSources = options.localSettingSources ?? ["project", "user"];
    this.#mcpServers = options.agentMcpServers;
  }

  #localOptions(): { cwd: string | string[]; settingSources: SettingSource[] } {
    const cwd: string | string[] =
      typeof this.#cwd === "string" ? this.#cwd : [...this.#cwd];
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

  #prepareMessages(messages: ChatMessage[]): ChatMessage[] {
    return prependBridgeContext(messages, this.#bridgeContext);
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

  /** `Cursor.models.list({ apiKey })` — proxied for U8 `/v1/models`. */
  async listModels(): Promise<SDKModel[]> {
    return Cursor.models.list({ apiKey: this.#apiKey });
  }

  /** OpenAI-style non-streaming chat completion → final assistant text. */
  async chatComplete(
    messages: ChatMessage[],
    modelId: string,
    bridge?: OpenAiToolBridgeInput,
  ): Promise<RunResult> {
    const prepared0 = this.#prepareMessages(messages);
    const prepared = this.#appendToolBridge(prepared0, bridge);
    return Agent.prompt(messagesToPrompt(prepared), {
      apiKey: this.#apiKey,
      model: { id: normalizeCursorModelId(modelId) },
      local: this.#localOptions(),
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
  ): Promise<StreamingChatHandle> {
    const prepared0 = this.#prepareMessages(messages);
    const prepared = this.#appendToolBridge(prepared0, bridge);
    const agent = await Agent.create({
      apiKey: this.#apiKey,
      model: { id: normalizeCursorModelId(modelId) },
      local: this.#localOptions(),
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

/** Strip optional cursor/ prefix from Hermes model ids. */
export function normalizeCursorModelId(model: string): string {
  if (model.startsWith("cursor/")) return model.slice("cursor/".length);
  if (model.startsWith("cursor:")) return model.slice("cursor:".length);
  return model;
}

/**
 * Flatten OpenAI chat messages into a single prompt string. The Cursor SDK
 * takes a single prompt; the bridge composes turns with explicit role labels
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
