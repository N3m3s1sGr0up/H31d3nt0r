/**
 * OpenAI-compatible clients commonly read `context_length` from `/v1/models`.
 * The Cursor SDK's `ModelListItem` does not currently expose this field, so:
 *
 * 1. Reads `MODEL_CONTEXT_LENGTHS` from env (comma-separated `id:tokens`).
 * 2. Otherwise omits `context_length` for that model entry.
 *
 * Clients may still impose their own context limits independent of this field.
 */

export interface ContextLengthTable {
  lookup(modelId: string): number | undefined;
}

export function parseContextLengthEnv(value: string | undefined): ContextLengthTable {
  const map = new Map<string, number>();
  if (value === undefined || value.trim() === "") return tableFromMap(map);
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const id = trimmed.slice(0, colon).trim();
    const tokensRaw = trimmed.slice(colon + 1).trim();
    const tokens = Number.parseInt(tokensRaw, 10);
    if (id.length === 0 || !Number.isInteger(tokens) || tokens <= 0) continue;
    map.set(id, tokens);
  }
  return tableFromMap(map);
}

function tableFromMap(map: Map<string, number>): ContextLengthTable {
  return {
    lookup(modelId: string): number | undefined {
      return map.get(modelId);
    },
  };
}
