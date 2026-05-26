/**
 * Rejects after `timeoutMs` with a dedicated error so callers can map to bridge
 * `request_timeout` / stream abort paths. Underlying Cursor work may still run
 * when the SDK has no cooperative cancel hook (notably `Agent.prompt`).
 */
export class TimeoutExceededError extends Error {
  readonly code = "timeout_exceeded";

  constructor(readonly phase: string, readonly timeoutMs: number) {
    super(`${phase}: exceeded ${timeoutMs}ms`);
    this.name = "TimeoutExceededError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  phase: string,
): Promise<T> {
  if (timeoutMs <= 0) return promise;

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutExceededError(phase, timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}
