import { describe, expect, it } from "vitest";

import {
  BRIDGE_TOOL_JSON_TOKEN,
  collectToolNames,
  parseBridgeToolJsonFromAssistantText,
} from "../src/openai/tool-bridge.js";
import type { OpenAIChatToolDefinition } from "../src/openai/types.js";

describe("tool-bridge", () => {
  it("collectToolNames gathers function names", () => {
    const tools: OpenAIChatToolDefinition[] = [
      { type: "function", function: { name: "memory_store" } },
      { type: "function", function: { name: "read_file" } },
    ];
    expect([...collectToolNames(tools)].sort()).toEqual(["memory_store", "read_file"]);
  });

  it("parseBridgeToolJsonFromAssistantText strips marker and returns tool_calls", () => {
    const raw = `Visible reply text\n${BRIDGE_TOOL_JSON_TOKEN}{"tool_calls":[{"id":"c1","type":"function","function":{"name":"ping","arguments":"{}"}}]}`;
    const allowed = new Set(["ping"]);
    const out = parseBridgeToolJsonFromAssistantText(raw, allowed);
    expect(out.content).toBe("Visible reply text");
    expect(out.tool_calls).toHaveLength(1);
    expect(out.tool_calls?.[0]?.function.name).toBe("ping");
  });

  it("drops tool_calls with names not in the allowlist", () => {
    const raw = `x\n${BRIDGE_TOOL_JSON_TOKEN}{"tool_calls":[{"id":"c1","type":"function","function":{"name":"evil","arguments":"{}"}}]}`;
    const out = parseBridgeToolJsonFromAssistantText(raw, new Set(["good"]));
    expect(out.tool_calls).toBeUndefined();
    expect(out.content).toBe("x");
  });
});
