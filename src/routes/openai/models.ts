import type { Hono } from "hono";

import type { CursorClient } from "../../cursor/client.js";
import { normalizeCursorModelId } from "../../cursor/client.js";
import { mapSdkStartupError, respondWithError, unknownModel } from "../../errors.js";
import type { ContextLengthTable } from "../../openai/context-length.js";
import type { OpenAIModelEntry, OpenAIModelList } from "../../openai/types.js";

export interface ModelsRouteDeps {
  readonly cursorClient: CursorClient;
  readonly contextLengths: ContextLengthTable;
  /** Optional clock override for deterministic tests. */
  readonly now?: () => number;
}

/**
 * OpenAI-compatible model catalog from `Cursor.models.list()`: list + retrieve.
 */
export function registerModelsRoute(app: Hono, deps: ModelsRouteDeps): void {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  app.get("/v1/models/:id", async (c) => {
    let rawId: string | undefined = c.req.param("id");
    if (typeof rawId === "string") {
      try {
        rawId = decodeURIComponent(rawId);
      } catch {
        return respondWithError(c, unknownModel(rawId ?? ""));
      }
    }
    if (!rawId || rawId.trim().length === 0) {
      return respondWithError(c, unknownModel("(empty)"));
    }

    const requested = normalizeCursorModelId(rawId);
    try {
      const sdkModels = await deps.cursorClient.listModels();
      const m = sdkModels.find((model) => model.id === requested);
      if (!m) {
        return respondWithError(c, unknownModel(requested));
      }
      const entry: OpenAIModelEntry = {
        id: m.id,
        object: "model",
        created: now(),
        owned_by: "cursor",
      };
      const ctx = deps.contextLengths.lookup(m.id);
      if (ctx !== undefined) {
        (entry as { context_length?: number }).context_length = ctx;
      }
      return c.json(entry);
    } catch (err) {
      return respondWithError(c, mapSdkStartupError(err, "Cursor models.retrieve failed"));
    }
  });

  app.get("/v1/models", async (c) => {
    try {
      const sdkModels = await deps.cursorClient.listModels();
      const created = now();
      const data: OpenAIModelEntry[] = sdkModels.map((m): OpenAIModelEntry => {
        const ctx = deps.contextLengths.lookup(m.id);
        const entry: OpenAIModelEntry = {
          id: m.id,
          object: "model",
          created,
          owned_by: "cursor",
        };
        if (ctx !== undefined) {
          (entry as { context_length?: number }).context_length = ctx;
        }
        return entry;
      });
      const body: OpenAIModelList = { object: "list", data };
      return c.json(body);
    } catch (err) {
      return respondWithError(c, mapSdkStartupError(err, "Cursor models.list failed"));
    }
  });
}
