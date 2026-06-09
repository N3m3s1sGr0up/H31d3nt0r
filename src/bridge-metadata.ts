import { readFileSync } from "node:fs";
import path from "node:path";

import { SERVICE_ROOT } from "./config.js";

/**
 * Human-readable notes for `bridgeGeneration` / health `changelog` — keep short.
 */
export const BRIDGE_GENERATION_CHANGELOG: readonly string[] = [
  "v0.3.0: operator hardening for OpenAI-compatible client integrations, GitHub CI (unit + gated Cursor integration), version bump/verify tooling, transitive dependency security overrides, README branding.",
  "v0.2.0: public OpenAI-first branding — service id `h31d3nt0r`, `OPENAI_COMPAT_TOOL_JSON` tool line, optional `BRIDGE_EXTRA_CWD` instead of implicit second homedir; capabilities field `extra_workspace_cwd`.",
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
