/** Combine an optional caller cancellation signal with a request deadline. */
export function withTimeout(signal: AbortSignal | undefined | null, ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return signal ?? undefined;
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  return anyFn ? anyFn([signal, timeout]) : signal;
}
