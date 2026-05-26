import { describe, expect, it } from "vitest";

import {
  AuthenticationError,
  ConfigurationError,
  CursorAgentError,
  NetworkError,
  RateLimitError,
} from "@cursor/sdk";

import { mapSdkStartupError, redactSecrets } from "../src/errors.js";

const SECRET_SHAPED = "sk-cursor-LEAKED-1234567890abcdef-FAKE";

describe("redactSecrets", () => {
  it("masks 20+ char alnum+dash runs", () => {
    expect(redactSecrets(`key=${SECRET_SHAPED}`)).toBe("key=[redacted]");
  });

  it("preserves short identifiers (model names, role labels, paths)", () => {
    const safe = "Cannot use model: composer-2.5. Available: composer-2, gpt-5.5";
    // No 20+ char alnum-dash run — should pass through unchanged. The `.`
    // characters in model ids interrupt the alnum-dash class so each id is
    // short enough to escape the regex.
    expect(redactSecrets(safe)).toBe(safe);
  });

  it("masks JWT-shaped tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.signature_part";
    expect(redactSecrets(jwt)).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });
});

describe("mapSdkStartupError — secret containment", () => {
  it("AuthenticationError: NEVER reflects err.message into client body", () => {
    const err = new AuthenticationError(`invalid key ${SECRET_SHAPED}`);
    const bridgeErr = mapSdkStartupError(err, "Cursor models.list failed");

    expect(bridgeErr.code).toBe("agent_startup_failed");
    expect(bridgeErr.status).toBe(502);
    expect(bridgeErr.retryable).toBe(false);
    expect(bridgeErr.message).not.toContain(SECRET_SHAPED);
    expect(bridgeErr.toBody().error.message).not.toContain(SECRET_SHAPED);

    // The secret survives only in internalDetails (server-side journald).
    expect(JSON.stringify(bridgeErr.internalDetails)).toContain(SECRET_SHAPED);
  });

  it("generic CursorAgentError: NEVER reflects err.message into client body", () => {
    const err = new CursorAgentError(`auth failed with key=${SECRET_SHAPED}`);
    const bridgeErr = mapSdkStartupError(err, "Cursor models.list failed");

    expect(bridgeErr.code).toBe("agent_startup_failed");
    expect(bridgeErr.message).not.toContain(SECRET_SHAPED);
    expect(bridgeErr.toBody().error.message).not.toContain(SECRET_SHAPED);
  });

  it("NetworkError: NEVER reflects err.message into client body", () => {
    const err = new NetworkError(
      `ECONNREFUSED https://internal.cursor/api?token=${SECRET_SHAPED}`,
    );
    const bridgeErr = mapSdkStartupError(err, "Cursor models.list failed");

    expect(bridgeErr.code).toBe("agent_startup_failed");
    expect(bridgeErr.retryable).toBe(true);
    expect(bridgeErr.message).not.toContain(SECRET_SHAPED);
    expect(bridgeErr.toBody().error.message).not.toContain("internal.cursor");
  });

  it("RateLimitError: NEVER reflects err.message into client body", () => {
    const err = new RateLimitError(`slow down ${SECRET_SHAPED}`);
    const bridgeErr = mapSdkStartupError(err, "Chat completion failed");

    expect(bridgeErr.code).toBe("rate_limited");
    expect(bridgeErr.status).toBe(429);
    expect(bridgeErr.retryable).toBe(true);
    expect(bridgeErr.message).not.toContain(SECRET_SHAPED);
  });

  it("ConfigurationError: forwards message AFTER redaction", () => {
    const innocuous = new ConfigurationError(
      "Cannot use model: fake-1. Available: composer-2, composer-2.5",
    );
    const ok = mapSdkStartupError(innocuous, "Chat stream failed to start");
    expect(ok.code).toBe("bad_request");
    expect(ok.message).toContain("composer-2.5");
    expect(ok.message).toContain("fake-1");

    const dangerous = new ConfigurationError(
      `model lookup failed with token ${SECRET_SHAPED}`,
    );
    const filtered = mapSdkStartupError(dangerous, "Chat stream failed to start");
    expect(filtered.code).toBe("bad_request");
    expect(filtered.message).not.toContain(SECRET_SHAPED);
    expect(filtered.message).toContain("[redacted]");
  });

  it("non-Error unknown values still produce a structured envelope", () => {
    const bridgeErr = mapSdkStartupError(
      { weird: "thrown literal", token: SECRET_SHAPED },
      "Chat completion failed",
    );
    expect(bridgeErr.code).toBe("internal_error");
    expect(bridgeErr.status).toBe(500);
    expect(bridgeErr.message).not.toContain(SECRET_SHAPED);
    // Internal details capture *something* useful for the operator.
    expect(bridgeErr.internalDetails).toBeDefined();
  });

  it("error_id is present, non-empty, and unique per call", () => {
    const a = mapSdkStartupError(new CursorAgentError("a"), "x");
    const b = mapSdkStartupError(new CursorAgentError("b"), "x");
    expect(a.errorId).toMatch(/^err_[0-9a-f]+$/);
    expect(b.errorId).toMatch(/^err_[0-9a-f]+$/);
    expect(a.errorId).not.toBe(b.errorId);
    expect(a.toBody().error.error_id).toBe(a.errorId);
  });
});
