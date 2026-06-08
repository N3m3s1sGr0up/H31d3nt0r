const MODEL_ALIASES = new Map<string, string>([["composer2-5", "composer-2.5"]]);

/** Resolve known client typos to canonical Cursor model ids. */
export function resolveModelAlias(modelId: string): string {
  return MODEL_ALIASES.get(modelId) ?? modelId;
}
