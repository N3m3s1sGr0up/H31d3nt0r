/**
 * SDK smoke test. Phase 1 ship gate (U1 verification).
 *
 * Pass criteria:
 *   - Exit 0 and stdout contains the literal token `SDK_OK`.
 * Failure classes (aligned with README / operator runbook):
 *   - Exit 1: startup failure (CursorAgentError or missing env). Fix environment.
 *   - Exit 2: run failure (started but agent did not produce SDK_OK or status != "finished").
 */

import { Agent, CursorAgentError } from "@cursor/sdk";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error(
    "CURSOR_API_KEY is required.\n" +
      "Set it in `.env.local` (chmod 600) in the service root and re-run, " +
      "or `export CURSOR_API_KEY=...` in this shell.",
  );
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(here, "..", "..");
const workspaceCwd =
  process.env.WORKSPACE_CWD ?? path.join(serviceRoot, "agent-workspace");

if (!existsSync(workspaceCwd)) {
  mkdirSync(workspaceCwd, { recursive: true });
}

const modelId = process.env.SDK_VERIFY_MODEL ?? "composer-2";

try {
  const result = await Agent.prompt(
    "Respond with exactly the token SDK_OK and nothing else.",
    {
      apiKey,
      model: { id: modelId },
      local: { cwd: workspaceCwd, settingSources: [] },
    },
  );

  if (result.status !== "finished") {
    console.error(`SDK run did not finish cleanly. status=${result.status}`);
    process.exit(2);
  }

  const serialized = JSON.stringify(result);
  if (serialized.includes("SDK_OK")) {
    console.log("SDK_OK");
    process.exit(0);
  }

  console.error(
    `SDK responded but token SDK_OK not found. status=${result.status}`,
  );
  console.error(serialized.slice(0, 1000));
  process.exit(2);
} catch (err) {
  if (err instanceof CursorAgentError) {
    console.error(
      `Startup failed: ${err.message} (retryable=${err.isRetryable})`,
    );
    process.exit(1);
  }
  throw err;
}
