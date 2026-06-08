import { describe, expect, it } from "vitest";

import { formatEaddrInUseMessage } from "../src/operator/bind-errors.js";

describe("formatEaddrInUseMessage", () => {
  it("includes status and stop hints for EADDRINUSE operators", () => {
    const message = formatEaddrInUseMessage("127.0.0.1", 8787);
    expect(message).toContain("./start.sh status");
    expect(message).toContain("./start.sh stop");
    expect(message).toContain("127.0.0.1:8787");
  });
});
