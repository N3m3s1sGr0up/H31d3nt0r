import { describe, expect, it } from "vitest";

import {
  BRIDGE_TOOL_JSON_TOKEN,
  buildOpenAiToolBridgeAppendage,
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

  it("tolerates extra whitespace between token and JSON", () => {
    const raw = `Reply\nOPENAI_COMPAT_TOOL_JSON   \n  {"tool_calls":[{"id":"c1","type":"function","function":{"name":"ping","arguments":"{}"}}]}`;
    const out = parseBridgeToolJsonFromAssistantText(raw, new Set(["ping"]));
    expect(out.content).toBe("Reply");
    expect(out.tool_calls).toHaveLength(1);
  });

  it("parses token on last non-empty line when trailing blank lines follow", () => {
    const payload = JSON.stringify({
      tool_calls: [{ id: "c1", type: "function", function: { name: "ping", arguments: "{}" } }],
    });
    const raw = `Visible\n${BRIDGE_TOOL_JSON_TOKEN}${payload}\n\n\n`;
    const out = parseBridgeToolJsonFromAssistantText(raw, new Set(["ping"]));
    expect(out.content).toBe("Visible");
    expect(out.tool_calls).toHaveLength(1);
  });

  it("recovers JSON when trailing garbage follows the object on the token line", () => {
    const payload = `{"tool_calls":[{"id":"c1","type":"function","function":{"name":"ping","arguments":"{}"}}]}`;
    const raw = `Hi\nOPENAI_COMPAT_TOOL_JSON ${payload} trailing-garbage`;
    const out = parseBridgeToolJsonFromAssistantText(raw, new Set(["ping"]));
    expect(out.content).toBe("Hi");
    expect(out.tool_calls).toHaveLength(1);
  });

  it("drops tool_calls with names not in the allowlist", () => {
    const raw = `x\n${BRIDGE_TOOL_JSON_TOKEN}{"tool_calls":[{"id":"c1","type":"function","function":{"name":"evil","arguments":"{}"}}]}`;
    const out = parseBridgeToolJsonFromAssistantText(raw, new Set(["good"]));
    expect(out.tool_calls).toBeUndefined();
    expect(out.content).toBe("x");
  });

  it("returns text-only response when tool_calls array is empty", () => {
    const raw = `Only text\n${BRIDGE_TOOL_JSON_TOKEN}{"tool_calls":[]}`;
    const out = parseBridgeToolJsonFromAssistantText(raw, new Set(["ping"]));
    expect(out.tool_calls).toBeUndefined();
    expect(out.content).toBe("Only text");
  });

  it("preserves content without tool_calls when JSON after token is malformed", () => {
    const raw = `Keep me\n${BRIDGE_TOOL_JSON_TOKEN}{not valid json`;
    const out = parseBridgeToolJsonFromAssistantText(raw, new Set(["ping"]));
    expect(out.tool_calls).toBeUndefined();
    expect(out.content).toBe(`Keep me\n${BRIDGE_TOOL_JSON_TOKEN}{not valid json`);
  });

  it("buildOpenAiToolBridgeAppendage warns against markdown fences", () => {
    const append = buildOpenAiToolBridgeAppendage(
      [{ type: "function", function: { name: "ping" } }],
      undefined,
    );
    expect(append).toContain("no markdown fences");
    expect(append).toContain("Emit the raw line only");
  });

  it("buildOpenAiToolBridgeAppendage includes a worked example using the first registered tool", () => {
    const append = buildOpenAiToolBridgeAppendage(
      [
        {
          type: "function",
          function: {
            name: "memory",
            parameters: { type: "object", properties: { action: { type: "string" } }, required: ["action"] },
          },
        },
      ],
      undefined,
    );
    expect(append).toContain("Worked example");
    expect(append).toContain('"name":"memory"');
    // The first required parameter is surfaced in the example arguments string.
    expect(append).toContain("action");
  });

  it("buildOpenAiToolBridgeAppendage routes client actions through the line, native tools for investigation", () => {
    const append = buildOpenAiToolBridgeAppendage(
      [{ type: "function", function: { name: "memory" } }],
      undefined,
    );
    expect(append).toContain("Client tool bridge");
    expect(append).toContain("route any action the user asked a registered tool to perform through this line");
    expect(append).toContain("Do not explain this mechanism to the user");
  });
});
