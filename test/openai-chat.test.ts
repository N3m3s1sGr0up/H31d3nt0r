import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { Semaphore } from "../src/concurrency.js";
import type { ChatMessage, CursorClient, StreamingChatHandle } from "../src/cursor/client.js";
import type { Config } from "../src/config.js";

import { ConfigurationError } from "@cursor/sdk";
import type { Run, RunResult, SDKAgent, SDKMessage } from "@cursor/sdk";

import { ROUTE_TIMEOUT_DEFAULTS } from "./test-timeouts-fixture.js";

function fakeClient(impl: Partial<CursorClient>): CursorClient {
  return impl as unknown as CursorClient;
}

function fixtureConfig() {
  return {
    cursorApiKey: "cursor-secret",
    bridgeApiKey: "bridge-secret",
    host: "127.0.0.1",
    port: 8787,
    workspaceCwd: "/tmp/bridge-test-workspace",
    localSettingSources: ["project", "user"] as const,
    maxAgents: 4,
    bridgeGeneration: 1_700_000_000_000,
    cursorReadyProbeTimeoutMs: 0,
    ...ROUTE_TIMEOUT_DEFAULTS,
  } satisfies Config;
}

function withBearer(headers: Record<string, string> = {}): Record<string, string> {
  return {
    ...headers,
    authorization: "Bearer bridge-secret",
    "content-type": "application/json",
  };
}

function chatBody(content: string, stream = false): string {
  return JSON.stringify({
    model: "composer-2",
    stream,
    messages: [{ role: "user", content }],
  });
}

interface FakeRunOptions {
  readonly text: string;
  readonly chunks?: string[];
  readonly status?: "finished" | "error" | "cancelled";
  readonly supportsStream?: boolean;
}

function makeFakeRun(opts: FakeRunOptions): Run {
  const status = opts.status ?? "finished";
  const supportsStream = opts.supportsStream ?? true;
  const result: RunResult = {
    id: "run-test",
    status,
    result: opts.text,
  };
  async function* stream(): AsyncGenerator<SDKMessage, void> {
    let acc = "";
    const segments = opts.chunks ?? [opts.text];
    for (const segment of segments) {
      acc += segment;
      yield {
        type: "assistant",
        agent_id: "agent-test",
        run_id: "run-test",
        message: {
          role: "assistant",
          content: [{ type: "text", text: acc }],
        },
      };
    }
  }
  return {
    id: "run-test",
    agentId: "agent-test",
    supports: (op) => (op === "stream" ? supportsStream : op === "wait"),
    unsupportedReason: () => (supportsStream ? undefined : "test_stub"),
    stream,
    conversation: async () => [],
    wait: async () => result,
    cancel: async () => {},
    status: "finished",
    onDidChangeStatus: () => () => {},
    result: opts.text,
  } as Run;
}

function makeFakeAgent(): SDKAgent {
  return {
    agentId: "agent-test",
    model: undefined,
    send: async () => makeFakeRun({ text: "" }),
    close: () => {},
    reload: async () => {},
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    [Symbol.asyncDispose]: async () => {},
  } as SDKAgent;
}

function fakeStreamingHandle(run: Run): StreamingChatHandle {
  return { agent: makeFakeAgent(), run };
}

describe("POST /v1/chat/completions (non-stream)", () => {
  it("returns OpenAI chat.completion JSON (AE7 happy path)", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async (_messages, _model) => ({
          id: "run-x",
          status: "finished",
          result: "SDK_OK",
        }),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("Reply SDK_OK"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      model: string;
      choices: Array<{
        message: { role: string; content: string };
        finish_reason: string;
      }>;
    };
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("composer-2");
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0]?.message.role).toBe("assistant");
    expect(body.choices[0]?.message.content).toBe("SDK_OK");
    expect(body.choices[0]?.finish_reason).toBe("stop");
  });

  it("rejects requests without bearer (no SDK call)", async () => {
    let chatCalled = false;
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => {
          chatCalled = true;
          return { id: "r", status: "finished", result: "" };
        },
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chatBody("Hello"),
    });
    expect(res.status).toBe(401);
    expect(chatCalled).toBe(false);
  });

  it("rejects non-JSON content-type with structured 400", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => ({ id: "r", status: "finished", result: "" }),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer bridge-secret",
        "content-type": "text/plain",
      },
      body: "hello",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("bad_request");
  });

  it("rejects missing model with structured 400", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => ({ id: "r", status: "finished", result: "" }),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("maps a Cursor ConfigurationError (unknown model) to 400", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => {
          throw new ConfigurationError("unknown model: fake-1");
        },
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({
        model: "fake-1",
        messages: [{ role: "user", content: "x" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("bad_request");
  });

  it("maps an `error` run result to 500 run_failed", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => ({
          id: "run-err",
          status: "error",
        }),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("oops"),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("run_failed");
  });

  it("never echoes BRIDGE_API_KEY or CURSOR_API_KEY in the response body", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => ({
          id: "r",
          status: "finished",
          result: "ok",
        }),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("Hi"),
    });
    const text = await res.text();
    expect(text).not.toContain("bridge-secret");
    expect(text).not.toContain("cursor-secret");
  });

  it("rejects bodies larger than the 1 MiB cap with 413 payload_too_large", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => ({ id: "r", status: "finished", result: "ok" }),
      }),
    });
    const huge = "x".repeat(1024 * 1024 + 64);
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({
        model: "composer-2",
        messages: [{ role: "user", content: huge }],
      }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("payload_too_large");
  });

  it("returns 429 rate_limited with Retry-After when MAX_AGENTS is saturated", async () => {
    let releaseSlow: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = () => {
        resolve();
      };
    });
    const { hono } = buildApp({
      config: { ...fixtureConfig(), maxAgents: 1 },
      cursorClient: fakeClient({
        chatComplete: async () => {
          await slow;
          return { id: "r", status: "finished", result: "ok" };
        },
      }),
    });

    const first = hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("slow"),
    });
    // Wait a tick so `first` actually acquires the semaphore slot.
    await Promise.resolve();
    await Promise.resolve();

    const second = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("fast"),
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("1");
    const body = (await second.json()) as {
      error?: { code?: string; retryable?: boolean };
    };
    expect(body.error?.code).toBe("rate_limited");
    expect(body.error?.retryable).toBe(true);

    releaseSlow?.();
    await first;
  });

  it("re-uses the slot after the slow request finishes (semaphore releases)", async () => {
    const sem = new Semaphore(1);
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => ({ id: "r", status: "finished", result: "ok" }),
      }),
    });
    // Acquire externally to confirm the route's release path isn't double-releasing
    const externalLease = sem.tryAcquire();
    expect(externalLease).not.toBeNull();
    // Issue two sequential requests against the app (which uses its own internal
    // semaphore of size config.maxAgents = 4). The point of the test is that
    // back-to-back requests do not leak slots.
    for (let i = 0; i < 6; i += 1) {
      const res = await hono.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: withBearer(),
        body: chatBody("ok"),
      });
      expect(res.status).toBe(200);
    }
    externalLease?.release();
  });

  it("error responses include error_id for log correlation", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        chatComplete: async () => {
          throw new ConfigurationError("unknown model: nope");
        },
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({
        model: "nope",
        messages: [{ role: "user", content: "x" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: { code?: string; error_id?: string };
    };
    expect(body.error?.error_id).toMatch(/^err_[0-9a-f]+$/);
  });

  it("returns 504 request_timeout when non-stream Cursor call exceeds BRIDGE_CHAT_COMPLETION_MS", async () => {
    const { hono } = buildApp({
      config: { ...fixtureConfig(), chatCompletionTimeoutMs: 25 },
      cursorClient: fakeClient({
        chatComplete: async () =>
          await new Promise((resolve) =>
            setTimeout(() => resolve({ id: "slow", status: "finished", result: "late" }), 500),
          ),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("wake me eventually"),
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error?: { code?: string; retryable?: boolean } };
    expect(body.error?.code).toBe("request_timeout");
    expect(body.error?.retryable).toBe(true);
  });

  it("rejects role=tool when tool_call_id is missing", async () => {
    const spy = vi.fn();
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({ chatComplete: spy }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({
        model: "composer-2",
        messages: [
          { role: "user", content: "Run tool" },
          { role: "tool", content: "{\"ok\":true}" },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("routes developer directives into Cursor system scaffolding", async () => {
    const chatComplete = vi.fn(async (): Promise<RunResult> => ({
      id: "r1",
      status: "finished",
      result: "ok",
    }));
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({ chatComplete }),
    });
    await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({
        model: "composer-2",
        messages: [
          { role: "developer", content: "Be terse." },
          { role: "user", content: "ping" },
        ],
      }),
    });
    expect(chatComplete).toHaveBeenCalled();
    const callTuple =
      chatComplete.mock.calls as unknown as [ChatMessage[], string, unknown | undefined][] | undefined;
    const flattened = callTuple?.[0]?.[0];
    expect(Array.isArray(flattened)).toBe(true);
    const messages = flattened as ChatMessage[];
    const dev = messages.find((m) => m.role === "system" && m.content.includes("[developer]"));
    expect(dev?.content).toContain("Be terse.");
  });

  it("proxies tool-enabled chat to upstream when configured", async () => {
    const upstreamJson = JSON.stringify({
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "ping", arguments: "{}" },
              },
            ],
          },
        },
      ],
    });

    const fetchMock = vi.fn(async (): Promise<Response> =>
      Promise.resolve(
        new Response(upstreamJson, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chatComplete = vi.fn();
    const { hono } = buildApp({
      config: {
        ...fixtureConfig(),
        chatUpstream: {
          mode: "tools",
          url: "https://upstream.example/v1/chat/completions",
          apiKey: "sk-upstream",
          timeoutMs: 10_000,
        },
      },
      cursorClient: fakeClient({ chatComplete }),
    });

    try {
      const res = await hono.request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: withBearer(),
        body: JSON.stringify({
          model: "gpt-any",
          messages: [{ role: "user", content: "hey" }],
          tools: [{ type: "function", function: { name: "ping" } }],
        }),
      });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(chatComplete).not.toHaveBeenCalled();

      const fetchCalls = fetchMock.mock.calls as unknown as [unknown, RequestInit | undefined][];
      const initRaw = fetchCalls[0]?.[1];
      expect(initRaw).toBeTruthy();
      const init = initRaw as RequestInit;
      expect(init.method).toBe("POST");
      const parsed = JSON.parse(String(init.body)) as { tools?: unknown[]; stream?: boolean };
      expect(parsed.tools?.length).toBe(1);
      const bodyJson = (await res.json()) as { choices: Array<{ finish_reason?: string }> };
      expect(bodyJson.choices[0]?.finish_reason).toBe("tool_calls");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("POST /v1/chat/completions (stream)", () => {
  it("emits OpenAI SSE chunks ending with [DONE]", async () => {
    const fakeRun = makeFakeRun({
      text: "Hello world",
      chunks: ["Hello ", "world"],
    });
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        openStreamingChat: async () => fakeStreamingHandle(fakeRun),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("Hi", true),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.toLowerCase()).toContain("text/event-stream");
    const text = await res.text();
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice("data: ".length));

    expect(dataLines.at(-1)).toBe("[DONE]");

    const chunks = dataLines
      .filter((l) => l !== "[DONE]")
      .map((l) => JSON.parse(l) as {
        object: string;
        choices: Array<{
          delta: { role?: string; content?: string };
          finish_reason: string | null;
        }>;
      });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]?.choices[0]?.delta.role).toBe("assistant");
    const assembled = chunks
      .map((ch) => ch.choices[0]?.delta.content ?? "")
      .join("");
    expect(assembled).toBe("Hello world");
    expect(chunks.at(-1)?.choices[0]?.finish_reason).toBe("stop");
  });

  it("returns 504 sdk_connect_timeout when streaming handshake exceeds BRIDGE_SDK_STREAM_CONNECT_MS", async () => {
    const { hono } = buildApp({
      config: { ...fixtureConfig(), sdkStreamingConnectTimeoutMs: 25 },
      cursorClient: fakeClient({
        openStreamingChat: async () =>
          await new Promise<StreamingChatHandle>(() => {
            /* never resolves until timeout loses the race */
          }),
      }),
    });

    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("streaming slow start", true),
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error?: { code?: string; retryable?: boolean } };
    expect(body.error?.code).toBe("sdk_connect_timeout");
    expect(body.error?.retryable).toBe(true);
  });

  it("forwards OpenAI tools to CursorClient as v1.1 bridge input", async () => {
    const chatComplete = vi.fn(async () => ({
      id: "run-1",
      status: "finished" as const,
      result: "Updated SOUL.md",
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({ chatComplete }),
    });

    const tools = [{ type: "function", function: { name: "memory_store" } }];
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({
        model: "composer-2",
        messages: [{ role: "user", content: "Update your soul" }],
        tools,
      }),
    });

    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chatComplete).toHaveBeenCalledWith(
      expect.any(Array),
      "composer-2",
      expect.objectContaining({ tools, toolChoice: undefined }),
    );
  });

  it("returns OpenAI tool_calls when the model emits OPENAI_COMPAT_TOOL_JSON", async () => {
    const payload = {
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "memory_store", arguments: "{}" },
        },
      ],
    };
    const chatComplete = vi.fn(async () => ({
      id: "run-1",
      status: "finished" as const,
      result: `Done.\nOPENAI_COMPAT_TOOL_JSON ${JSON.stringify(payload)}`,
    }));

    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({ chatComplete }),
    });

    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({
        model: "composer-2",
        messages: [{ role: "user", content: "Remember this" }],
        tools: [{ type: "function", function: { name: "memory_store" } }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      choices: Array<{
        finish_reason: string;
        message: { content: string | null; tool_calls?: { function: { name: string } }[] };
      }>;
    };
    expect(body.choices[0]?.finish_reason).toBe("tool_calls");
    expect(body.choices[0]?.message.content).toBe("Done.");
    expect(body.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("memory_store");
  });

  it("emits synthetic usage chunk when stream_options.include_usage is true", async () => {
    const fakeRun = makeFakeRun({ text: "Hi", chunks: ["H", "i"] });
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        openStreamingChat: async () => fakeStreamingHandle(fakeRun),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: JSON.stringify({
        model: "composer-2",
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "Yo" }],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice("data: ".length));
    const penultimate = JSON.parse(dataLines[dataLines.length - 2] as string) as {
      choices: Array<{ finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number };
    };
    expect(penultimate.usage?.prompt_tokens).toBe(0);
    expect(penultimate.choices[0]?.finish_reason).toBe("stop");
  });

  it("returns 422 stream_unsupported when the SDK run does not support streaming", async () => {
    const fakeRun = makeFakeRun({
      text: "x",
      supportsStream: false,
    });
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        openStreamingChat: async () => fakeStreamingHandle(fakeRun),
      }),
    });
    const res = await hono.request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: withBearer(),
      body: chatBody("Hi", true),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("stream_unsupported");
  });
});
