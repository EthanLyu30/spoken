/** Only bounded categories and numeric provider codes leave the browser. */
export const ASR_REASONS = [
  "empty", "incomplete", "timeout", "disconnect", "provider_error",
  "http_error", "unavailable", "cancelled", "unknown",
] as const;
export type AsrReason = typeof ASR_REASONS[number];

export function asrFailure(error: unknown, signal?: AbortSignal, closed = false): {
  outcome: "error" | "timeout" | "cancelled";
  asr_reason: AsrReason;
  provider_code?: number;
} {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  const reason = signal?.reason;
  if (closed || (signal?.aborted && reason?.name !== "TimeoutError")) {
    return { outcome: "cancelled", asr_reason: "cancelled" };
  }
  if (reason?.name === "TimeoutError" || name === "TimeoutError") {
    return { outcome: "timeout", asr_reason: "timeout" };
  }
  if (name === "AbortError") return { outcome: "cancelled", asr_reason: "cancelled" };
  const code = (error as { providerCode?: unknown } | null)?.providerCode;
  if (typeof code === "number" && Number.isInteger(code) && code > 0 && code <= 99_999) {
    return { outcome: "error", asr_reason: "provider_error", provider_code: code };
  }
  if (name === "IncompleteTranscriptionError") return { outcome: "error", asr_reason: "incomplete" };
  const message = error instanceof Error ? error.message : "";
  if (/timed? ?out/i.test(message)) return { outcome: "timeout", asr_reason: "timeout" };
  if (/disconnect|closed|network|fetch/i.test(message)) return { outcome: "error", asr_reason: "disconnect" };
  if (/no (audio|transcript)|empty/i.test(message)) return { outcome: "error", asr_reason: "empty" };
  if (/unavailable|cooling down/i.test(message)) return { outcome: "error", asr_reason: "unavailable" };
  if (/asr failed/i.test(message)) return { outcome: "error", asr_reason: "http_error" };
  return { outcome: "error", asr_reason: "unknown" };
}
