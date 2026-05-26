import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { CursorClient } from "../src/cursor/client.js";
import { parseContextLengthEnv } from "../src/openai/context-length.js";
import type { Config } from "../src/config.js";

import { AuthenticationError, ConfigurationError } from "@cursor/sdk";
import type { SDKModel } from "@cursor/sdk";

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
  return { ...headers, authorization: "Bearer bridge-secret" };
}

const SAMPLE_MODELS: SDKModel[] = [
  { id: "composer-2", displayName: "Composer 2" },
  { id: "composer-2.5", displayName: "Composer 2.5" },
];

describe("GET /v1/models", () => {
  it("returns OpenAI list shape over Cursor.models.list()", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        listModels: async () => SAMPLE_MODELS,
      }),
      contextLengths: parseContextLengthEnv(""),
    });
    const res = await hono.request("http://localhost/v1/models", {
      headers: withBearer(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      data: Array<{ id: string; object: string; owned_by: string }>;
    };
    expect(body.object).toBe("list");
    expect(body.data.map((m) => m.id)).toEqual(["composer-2", "composer-2.5"]);
    expect(body.data.every((m) => m.object === "model" && m.owned_by === "cursor")).toBe(true);
    expect(body.data.every((m) => !("context_length" in m))).toBe(true);
  });

  it("includes context_length only for models present in MODEL_CONTEXT_LENGTHS", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        listModels: async () => SAMPLE_MODELS,
      }),
      contextLengths: parseContextLengthEnv("composer-2:200000,composer-2.5:128000"),
    });
    const res = await hono.request("http://localhost/v1/models", {
      headers: withBearer(),
    });
    const body = (await res.json()) as {
      data: Array<{ id: string; context_length?: number }>;
    };
    const lengths = Object.fromEntries(body.data.map((m) => [m.id, m.context_length]));
    expect(lengths["composer-2"]).toBe(200000);
    expect(lengths["composer-2.5"]).toBe(128000);
  });

  it("rejects requests without bearer", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        listModels: async () => SAMPLE_MODELS,
      }),
    });
    const res = await hono.request("http://localhost/v1/models");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("unauthorized");
  });

  it("maps a Cursor AuthenticationError to 502 agent_startup_failed", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        listModels: async () => {
          throw new AuthenticationError("invalid api key");
        },
      }),
    });
    const res = await hono.request("http://localhost/v1/models", {
      headers: withBearer(),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: { code?: string; retryable?: boolean } };
    expect(body.error?.code).toBe("agent_startup_failed");
    expect(body.error?.retryable).toBe(false);
  });

  it("maps a Cursor ConfigurationError to 400 bad_request", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        listModels: async () => {
          throw new ConfigurationError("unknown model: fake-1");
        },
      }),
    });
    const res = await hono.request("http://localhost/v1/models", {
      headers: withBearer(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("bad_request");
  });

  it("retrieves GET /v1/models/:id in OpenAI single-model shape", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        listModels: async () => SAMPLE_MODELS,
      }),
      contextLengths: parseContextLengthEnv("composer-2:99000"),
    });
    const res = await hono.request("http://localhost/v1/models/cursor%2Fcomposer-2", {
      headers: withBearer(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      object: string;
      id: string;
      owned_by?: string;
      context_length?: number;
    };
    expect(body.object).toBe("model");
    expect(body.id).toBe("composer-2");
    expect(body.context_length).toBe(99000);
  });

  it("returns 404 when GET /v1/models/:id is unknown", async () => {
    const { hono } = buildApp({
      config: fixtureConfig(),
      cursorClient: fakeClient({
        listModels: async () => SAMPLE_MODELS,
      }),
    });
    const res = await hono.request("http://localhost/v1/models/missing-model", {
      headers: withBearer(),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string; type?: string } };
    expect(body.error?.code).toBe("model_not_found");
    expect(body.error?.type).toBe("invalid_request_error");
  });
});
