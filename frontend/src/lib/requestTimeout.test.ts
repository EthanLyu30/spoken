import { afterEach, expect, it, vi } from "vitest";
import { withTimeout } from "./requestTimeout";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([true, false])("keeps a deadline without AbortSignal.any (native timeout: %s)", (hasTimeout) => {
  const caller = new AbortController();
  vi.useFakeTimers();
  const timeout = (ms: number) => {
    const deadline = new AbortController();
    setTimeout(() => deadline.abort(new DOMException("Expired", "TimeoutError")), ms);
    return deadline.signal;
  };
  vi.stubGlobal("AbortSignal", hasTimeout ? { timeout } : {});
  const signal = withTimeout(caller.signal, 3000);
  vi.advanceTimersByTime(2999);
  expect(signal?.aborted).toBe(false);
  vi.advanceTimersByTime(1);
  expect(signal?.reason?.name).toBe("TimeoutError");
  expect(caller.signal.aborted).toBe(false);
});

it("preserves caller cancellation and clears the fallback timer", () => {
  vi.useFakeTimers();
  vi.stubGlobal("AbortSignal", {});
  const caller = new AbortController();
  const reason = new DOMException("Left the page", "AbortError");
  const signal = withTimeout(caller.signal, 3000);
  caller.abort(reason);
  expect(signal?.reason).toBe(reason);
  expect(vi.getTimerCount()).toBe(0);
  expect(withTimeout(caller.signal, 3000)?.reason).toBe(reason);
});

it("times out an unscoped request on a browser without native timeout helpers", () => {
  vi.useFakeTimers();
  vi.stubGlobal("AbortSignal", {});
  const signal = withTimeout(undefined, 100);
  vi.advanceTimersByTime(100);
  expect(signal?.reason?.name).toBe("TimeoutError");
});
