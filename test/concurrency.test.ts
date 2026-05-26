import { describe, expect, it } from "vitest";

import { Semaphore } from "../src/concurrency.js";

describe("Semaphore", () => {
  it("rejects non-positive or non-integer capacity", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
    expect(() => new Semaphore(1.5)).toThrow();
    expect(() => new Semaphore(Number.NaN)).toThrow();
  });

  it("acquires up to capacity then returns null", () => {
    const sem = new Semaphore(2);
    const a = sem.tryAcquire();
    const b = sem.tryAcquire();
    const c = sem.tryAcquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).toBeNull();
    expect(sem.inUse).toBe(2);
  });

  it("release frees one slot for re-use", () => {
    const sem = new Semaphore(1);
    const a = sem.tryAcquire();
    expect(a).not.toBeNull();
    expect(sem.tryAcquire()).toBeNull();
    a?.release();
    expect(sem.inUse).toBe(0);
    const b = sem.tryAcquire();
    expect(b).not.toBeNull();
  });

  it("double-release of the same lease does not steal another lease's slot", () => {
    const sem = new Semaphore(2);
    const a = sem.tryAcquire();
    const b = sem.tryAcquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    a?.release();
    a?.release();
    a?.release();
    expect(sem.inUse).toBe(1);
    expect(b?.released).toBe(false);
  });

  it("exposes capacity unchanged after activity", () => {
    const sem = new Semaphore(3);
    sem.tryAcquire();
    sem.tryAcquire();
    expect(sem.capacity).toBe(3);
    expect(sem.inUse).toBe(2);
  });
});
