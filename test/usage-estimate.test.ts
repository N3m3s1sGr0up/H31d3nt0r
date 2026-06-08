import { describe, expect, it } from "vitest";

import { parseChatCompletionBody } from "../src/openai/chat-normalize.js";
import { estimateChatCompletionUsage, estimateTextTokensRough } from "../src/openai/usage-estimate.js";

describe("estimateTextTokensRough", () => {
  it("uses ceiling division (~4 chars/token)", () => {
    expect(estimateTextTokensRough("")).toBe(0);
    expect(estimateTextTokensRough("a")).toBe(1);
    expect(estimateTextTokensRough("abcd")).toBe(1);
    expect(estimateTextTokensRough("abcde")).toBe(2);
  });
});

describe("estimateChatCompletionUsage", () => {
  it("counts prompt messages and assistant completion", () => {
    const parsed = parseChatCompletionBody({
      model: "composer-2.5",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello there!" },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const usage = estimateChatCompletionUsage(parsed.body, { content: "Hi back!" });
    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBeGreaterThan(0);
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
  });

  it("includes tool schema bytes in prompt estimate", () => {
    const parsed = parseChatCompletionBody({
      model: "composer-2.5",
      messages: [{ role: "user", content: "ping" }],
      tools: [{ type: "function", function: { name: "memory", parameters: { type: "object" } } }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const withoutTools = estimateChatCompletionUsage(
      { ...parsed.body, tools: undefined },
      { content: "pong" },
    );
    const withTools = estimateChatCompletionUsage(parsed.body, { content: "pong" });
    expect(withTools.prompt_tokens).toBeGreaterThan(withoutTools.prompt_tokens);
  });
});
