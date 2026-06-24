import { readFileSync, statSync } from "node:fs";

/** Default byte cap when none is supplied. Mirrors `BRIDGE_CONTEXT_MAX_BYTES`. */
export const DEFAULT_OPERATOR_CONTEXT_MAX_BYTES = 16384;

const TRUNCATION_MARKER = "\n…[operator context truncated]";

export interface OperatorContextReaderOptions {
  /** Absolute path to the operator context file. Unset disables injection. */
  readonly path?: string;
  /** Maximum bytes read from the file before truncation. */
  readonly maxBytes?: number;
}

interface CacheEntry {
  readonly mtimeMs: number;
  readonly size: number;
  readonly value: string | undefined;
}

/**
 * Reads an operator-authored context file on demand and caches the parsed value
 * by `(mtimeMs, size)`. Operators can edit the file and have the next request
 * pick up the change without a restart. Reads are bounded by `maxBytes`, and any
 * filesystem error resolves to `undefined` rather than throwing into the request
 * path — a missing or unreadable context file simply means "no extra context".
 */
export class OperatorContextReader {
  readonly #path: string | undefined;
  readonly #maxBytes: number;
  #cache: CacheEntry | undefined;

  constructor(options: OperatorContextReaderOptions = {}) {
    this.#path = options.path;
    this.#maxBytes = options.maxBytes ?? DEFAULT_OPERATOR_CONTEXT_MAX_BYTES;
  }

  /** True when a context file path is configured (regardless of readability). */
  get configured(): boolean {
    return this.#path !== undefined;
  }

  load(): string | undefined {
    const filePath = this.#path;
    if (filePath === undefined) return undefined;

    let mtimeMs: number;
    let size: number;
    try {
      const stat = statSync(filePath);
      mtimeMs = stat.mtimeMs;
      size = stat.size;
    } catch {
      this.#cache = undefined;
      return undefined;
    }

    const cached = this.#cache;
    if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.size === size) {
      return cached.value;
    }

    let value: string | undefined;
    try {
      let text = readFileSync(filePath, "utf8");
      if (this.#maxBytes > 0 && Buffer.byteLength(text, "utf8") > this.#maxBytes) {
        text = Buffer.from(text, "utf8").subarray(0, this.#maxBytes).toString("utf8") + TRUNCATION_MARKER;
      }
      const trimmed = text.trim();
      value = trimmed.length > 0 ? trimmed : undefined;
    } catch {
      value = undefined;
    }

    this.#cache = { mtimeMs, size, value };
    return value;
  }
}
