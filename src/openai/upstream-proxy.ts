import { buildUpstreamChatJson, type ParsedChatCompletionRequest } from "./chat-normalize.js";

export type ChatUpstreamMode = "off" | "tools" | "always";

export interface ChatUpstreamConfig {
  readonly mode: ChatUpstreamMode;
  /** Full URL including path, e.g. https://api.openai.com/v1/chat/completions */
  readonly url: string | undefined;
  readonly apiKey: string | undefined;
  readonly timeoutMs: number;
}

export function wantsUpstreamInference(cfg: ChatUpstreamConfig, parsed: ParsedChatCompletionRequest): boolean {
  if (cfg.mode === "off") return false;
  if (cfg.mode === "always") return true;
  const hasTools = parsed.tools !== undefined && parsed.tools.length > 0;
  return cfg.mode === "tools" && hasTools;
}

export async function upstreamOpenAiCompatibleFetch(init: {
  readonly cfg: ChatUpstreamConfig;
  readonly parsed: ParsedChatCompletionRequest;
  /** Client abort disconnects upstream fetches mid-flight. */
  readonly clientAbortSignal?: AbortSignal;
  /** Echo router correlation ids when callers send valid `X-Request-Id`. */
  readonly forwardedRequestId?: string;
}): Promise<Response> {
  const url = init.cfg.url;
  const apiKey = init.cfg.apiKey;
  if (!url?.length || !apiKey?.length) {
    throw new Error("Upstream URL and API key must be configured for this mode.");
  }

  const body = JSON.stringify(buildUpstreamChatJson(init.parsed));
  const timeoutMs = init.cfg.timeoutMs;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
  }

  const onAbort = (): void => {
    controller.abort();
  };
  if (init.clientAbortSignal) {
    if (init.clientAbortSignal.aborted) {
      controller.abort();
    }
    init.clientAbortSignal.addEventListener("abort", onAbort);
  }

  try {
    const headers: Record<string, string> = {
      Accept: "*/*",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (init.forwardedRequestId?.length) {
      headers["X-Request-Id"] = init.forwardedRequestId;
    }
    return await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (init.clientAbortSignal) {
      init.clientAbortSignal.removeEventListener("abort", onAbort);
    }
  }
}
