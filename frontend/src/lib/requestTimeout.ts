/** Combine an optional caller cancellation signal with a request deadline. */
export function withTimeout(signal: AbortSignal | undefined | null, ms: number): AbortSignal | undefined {
  if (signal?.aborted) return signal;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    if (!signal) return AbortSignal.timeout(ms);
    if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  }
  if (typeof AbortController === "undefined") return signal ?? undefined;

  const controller = new AbortController();
  const onAbort = () => {
    clearTimeout(timer);
    controller.abort(signal?.reason);
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
