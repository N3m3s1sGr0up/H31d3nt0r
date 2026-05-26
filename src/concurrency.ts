/**
 * Non-blocking counting semaphore with per-acquisition leases.
 *
 * Used to bound the number of in-flight Cursor SDK runs (`MAX_AGENTS`).
 * Callers `tryAcquire()` synchronously; on capacity miss they receive
 * `null` and should return 429 with `Retry-After` rather than queue, so a
 * slow client cannot wedge fast clients waiting in line.
 *
 * Each successful acquisition returns its own `SemaphoreLease`. Calling
 * `lease.release()` more than once is a no-op for that lease, so paired
 * cleanup paths (`onAbort` + `finally`) cannot accidentally double-release
 * and steal another request's slot.
 */

export interface SemaphoreLease {
  release(): void;
  readonly released: boolean;
}

export class Semaphore {
  readonly #capacity: number;
  #inUse = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(
        `Semaphore capacity must be a positive integer (got ${String(capacity)}).`,
      );
    }
    this.#capacity = capacity;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get inUse(): number {
    return this.#inUse;
  }

  tryAcquire(): SemaphoreLease | null {
    if (this.#inUse >= this.#capacity) return null;
    this.#inUse += 1;
    let released = false;
    const lease: SemaphoreLease = {
      release: () => {
        if (released) return;
        released = true;
        this.#inUse -= 1;
      },
      get released() {
        return released;
      },
    };
    return lease;
  }
}
