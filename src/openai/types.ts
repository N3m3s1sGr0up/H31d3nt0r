/**
 * OpenAI Chat Completions request/response shapes used by the Hermes
 * provider. Intentionally minimal — only the fields we actually read or
 * emit. Everything else is accepted but ignored on input and not produced
 * on output.
 */

export type OpenAIChatRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface OpenAIToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface OpenAIChatMessageIn {
  readonly role: OpenAIChatRole;
  readonly content: string | null;
  /** OpenAI assistant tool_calls from prior turns (Hermes round-trip). */
  readonly tool_calls?: readonly OpenAIToolCall[];
  /** Required when role is tool (Hermes/OpenAI parallel tool-call round-trip). */
  readonly tool_call_id?: string;
}

export interface OpenAIChatToolDefinition {
  readonly type: string;
  readonly function?: {
    readonly name?: string;
    readonly description?: string;
    readonly parameters?: unknown;
  };
}

export interface OpenAIChatCompletionsRequest {
  readonly model: string;
  readonly messages: OpenAIChatMessageIn[];
  readonly stream?: boolean;
  readonly tools?: OpenAIChatToolDefinition[];
  readonly tool_choice?: unknown;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly n?: number;
  readonly stop?: string | string[];
  readonly max_tokens?: number;
  readonly user?: string;
  readonly stream_options?: { readonly include_usage?: boolean };
}

export interface OpenAIChatCompletionChoice {
  readonly index: number;
  readonly message: {
    readonly role: "assistant";
    readonly content: string | null;
    readonly tool_calls?: readonly OpenAIToolCall[];
  };
  readonly finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | null;
}

export interface OpenAIChatCompletionUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
}

export interface OpenAIChatCompletion {
  readonly id: string;
  readonly object: "chat.completion";
  readonly created: number;
  readonly model: string;
  readonly choices: OpenAIChatCompletionChoice[];
  readonly usage: OpenAIChatCompletionUsage;
}

export interface OpenAIChatCompletionChunkDelta {
  readonly role?: "assistant";
  readonly content?: string | null;
  readonly tool_calls?: readonly OpenAIToolCall[];
}

export interface OpenAIChatCompletionChunkChoice {
  readonly index: number;
  readonly delta: OpenAIChatCompletionChunkDelta;
  readonly finish_reason: "stop" | "length" | "tool_calls" | null;
}

export interface OpenAIChatCompletionChunk {
  readonly id: string;
  readonly object: "chat.completion.chunk";
  readonly created: number;
  readonly model: string;
  readonly choices: OpenAIChatCompletionChunkChoice[];
  /** Present on the terminal chunk when `stream_options.include_usage` is honoured. */
  readonly usage?: OpenAIChatCompletionUsage;
}

export interface OpenAIModelEntry {
  readonly id: string;
  readonly object: "model";
  readonly created: number;
  readonly owned_by: string;
  readonly context_length?: number;
}

export interface OpenAIModelList {
  readonly object: "list";
  readonly data: OpenAIModelEntry[];
}
