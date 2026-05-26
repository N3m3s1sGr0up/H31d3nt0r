import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { bearerAuth } from "../src/auth.js";

function buildAuthHarness(token: string) {
  const app = new Hono();
  app.use("/v1/*", bearerAuth(token));
  app.get("/v1/whoami", (c) => c.json({ ok: true }));
  return app;
}

describe("bearerAuth", () => {
  it("rejects requests with no Authorization header", async () => {
    const app = buildAuthHarness("bridge-secret");
    const res = await app.request("http://localhost/v1/whoami");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("unauthorized");
  });

  it("rejects requests with a non-Bearer scheme", async () => {
    const app = buildAuthHarness("bridge-secret");
    const res = await app.request("http://localhost/v1/whoami", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an empty bearer", async () => {
    const app = buildAuthHarness("bridge-secret");
    const res = await app.request("http://localhost/v1/whoami", {
      headers: { authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a mismatched token (different length)", async () => {
    const app = buildAuthHarness("bridge-secret");
    const res = await app.request("http://localhost/v1/whoami", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a mismatched token (same length)", async () => {
    const app = buildAuthHarness("bridge-secret");
    const res = await app.request("http://localhost/v1/whoami", {
      headers: { authorization: "Bearer brodge-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a matching token", async () => {
    const app = buildAuthHarness("bridge-secret");
    const res = await app.request("http://localhost/v1/whoami", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it("throws if constructed with an empty expected token", () => {
    expect(() => bearerAuth("")).toThrow();
  });

  it("does not leak the token in any 401 response body", async () => {
    const app = buildAuthHarness("bridge-secret");
    const res = await app.request("http://localhost/v1/whoami", {
      headers: { authorization: "Bearer wrong-token-attempt" },
    });
    const text = await res.text();
    expect(text).not.toContain("bridge-secret");
    expect(text).not.toContain("wrong-token-attempt");
  });

  it("returns identical 401 messages for every failure mode (no oracle)", async () => {
    const app = buildAuthHarness("bridge-secret");
    const cases: Array<[string, Record<string, string> | undefined]> = [
      ["missing", undefined],
      ["wrong-scheme", { authorization: "Basic dXNlcjpwYXNz" }],
      ["empty-bearer", { authorization: "Bearer " }],
      ["short-mismatch", { authorization: "Bearer wrong" }],
      ["same-length-mismatch", { authorization: "Bearer brodge-secret" }],
    ];
    const messages: string[] = [];
    for (const [, headers] of cases) {
      const res = await app.request("http://localhost/v1/whoami", { headers });
      const body = (await res.json()) as { error?: { message?: string } };
      messages.push(body.error?.message ?? "");
    }
    const unique = new Set(messages);
    expect(unique.size).toBe(1);
    expect([...unique][0]).toBe("Invalid or missing bearer token.");
  });

  it("accepts a token configured with a trailing newline (trim parity)", async () => {
    const app = buildAuthHarness("bridge-secret\n");
    const res = await app.request("http://localhost/v1/whoami", {
      headers: { authorization: "Bearer bridge-secret" },
    });
    expect(res.status).toBe(200);
  });

  it("accepts a presented token with surrounding whitespace", async () => {
    const app = buildAuthHarness("bridge-secret");
    const res = await app.request("http://localhost/v1/whoami", {
      headers: { authorization: "Bearer  bridge-secret  " },
    });
    expect(res.status).toBe(200);
  });
});
