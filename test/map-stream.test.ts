import { describe, expect, it } from "vitest";

import type { SDKMessage } from "@cursor/sdk";

import { createStreamProgressTracker } from "../src/openai/map-stream.js";

function assistant(textCumulative: string): SDKMessage {
  return {
    type: "assistant",
    agent_id: "a",
    run_id: "r",
    message: { role: "assistant", content: [{ type: "text", text: textCumulative }] },
  };
}

/** Feed cumulative-snapshot deltas, then finalize; return the joined output. */
function runCumulative(tokens: string[]): string {
  const tracker = createStreamProgressTracker();
  const out: string[] = [];
  let acc = "";
  for (const t of tokens) {
    acc += t;
    out.push(...tracker.consume(assistant(acc)));
  }
  out.push(...tracker.drainFinalAnswer());
  return out.join("");
}

/** Feed incremental deltas (each message is only the new piece). */
function runIncremental(tokens: string[]): string {
  const tracker = createStreamProgressTracker();
  const out: string[] = [];
  for (const t of tokens) out.push(...tracker.consume(assistant(t)));
  out.push(...tracker.drainFinalAnswer());
  return out.join("");
}

describe("createStreamProgressTracker", () => {
  it("streams cumulative-snapshot deltas verbatim (spaces + newlines preserved)", () => {
    const full = "Hello world\nsecond line\n";
    expect(runCumulative(["Hello", " world\n", "second", " line\n"])).toBe(full);
  });

  it("streams incremental deltas without mashing words or dropping spaces", () => {
    const tokens = ["The user is asking what", " skills are", " available.", " Listing them now."];
    expect(runIncremental(tokens)).toBe(tokens.join(""));
  });

  it("delivers the full answer including the trailing word (no dropped tail)", () => {
    const tokens = ["pong", " — Anton", " here, on", " composer-2.5", " via H31d3nt0r.", " Ready when you are."];
    expect(runIncremental(tokens)).toBe(tokens.join(""));
  });

  it("never leaks the OPENAI_COMPAT_TOOL_JSON sentinel but keeps it in answerText()", () => {
    const tracker = createStreamProgressTracker();
    const payload = '{"tool_calls":[{"id":"c1","type":"function","function":{"name":"memory","arguments":"{}"}}]}';
    const full = `All done.\nOPENAI_COMPAT_TOOL_JSON ${payload}`;
    const lines = [
      ...tracker.consume(assistant("All done.\n")),
      ...tracker.consume(assistant(full)),
      ...tracker.drainFinalAnswer(),
    ];
    expect(lines.join("\n")).not.toContain("OPENAI_COMPAT_TOOL_JSON");
    expect(lines.join("\n")).toContain("All done.");
    expect(tracker.answerText()).toContain("OPENAI_COMPAT_TOOL_JSON");
  });

  it("shows one line per Cursor tool call and surfaces failures, not completions", () => {
    const tracker = createStreamProgressTracker();
    const lines: string[] = [];
    const mk = (call_id: string, name: string, status: "running" | "completed" | "error", args?: unknown): SDKMessage => ({
      type: "tool_call",
      agent_id: "a",
      run_id: "r",
      call_id,
      name,
      status,
      ...(args !== undefined ? { args } : {}),
    });
    lines.push(...tracker.consume(mk("c1", "read", "running", { path: "index.md" })));
    lines.push(...tracker.consume(mk("c1", "read", "completed", { path: "index.md" })));
    lines.push(...tracker.consume(mk("c2", "grep", "error")));
    const joined = lines.join("");
    expect(joined).toContain("⚙ read index.md");
    expect(joined).toContain("✗ grep (failed)");
    expect(joined).not.toContain("completed");
  });
});
