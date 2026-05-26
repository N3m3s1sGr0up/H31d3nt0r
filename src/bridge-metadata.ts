import { readFileSync } from "node:fs";
import path from "node:path";

import { SERVICE_ROOT } from "./config.js";

/**
 * Single source Hermes/operators use to interpret `bridgeGeneration` bumps across
 * restarts — keep bullets short so health/capabilities stay compact.
 */
export const BRIDGE_GENERATION_CHANGELOG: readonly string[] = [
  "v0.1.3: upstream OpenAI-compat chat proxy (BRIDGE_CHAT_UPSTREAM_*), GET /v1/models/:id, chat normalization (developer, multimodal, tool_call_id), SSE usage stub for stream_options.include_usage, structured errors expose OpenAI type/param mirrors alongside bridge codes.",
  "v0.1.1: timeouts (non-stream + stream wall-clock + SDK connect), SSE comment heartbeats, structured SSE bridge.error payloads, GET /ready (Cursor probe), health reports version + changelog.",
];

export interface BridgeReleaseMetadata {
  readonly version: string;
  readonly generationChangelog: readonly string[];
}

let cachedMetadata: BridgeReleaseMetadata | undefined;

function readPackageVersion(): string {
  const pkgPath = path.join(SERVICE_ROOT, "package.json");
  try {
    const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    if (typeof raw.version === "string" && raw.version.length > 0) {
      return raw.version;
    }
  } catch {
    /* swallow */
  }
  return "0.0.0";
}

/** Release metadata (+ changelog bullets) stamped from package.json beside `SERVICE_ROOT`. */
export function bridgeReleaseMetadata(): BridgeReleaseMetadata {
  if (cachedMetadata !== undefined) return cachedMetadata;
  cachedMetadata = {
    version: readPackageVersion(),
    generationChangelog: BRIDGE_GENERATION_CHANGELOG,
  };
  return cachedMetadata;
}
