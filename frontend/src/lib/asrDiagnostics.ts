/** Only bounded categories and numeric provider codes leave the browser. */
export const ASR_REASONS = [
  "empty", "incomplete", "timeout", "disconnect", "provider_error",
  "http_error", "unavailable", "cancelled", "user_cancelled", "quota_cooldown", "unknown",
] as const;
export type AsrReason = typeof ASR_REASONS[number];

export const ASR_FALLBACK_REASONS = [
  "none", "timeout", "disconnect", "provider_error", "empty", "http_error", "unavailable", "unknown",
] as const;
export type AsrFallbackReason = typeof ASR_FALLBACK_REASONS[number];
export const asrFallbackReason = (reason: AsrReason): AsrFallbackReason =>
  ASR_FALLBACK_REASONS.find(value => value === reason) ?? "unknown";

export class AsrUserCancellation extends DOMException {
  constructor() { super("User ended the call", "AbortError"); }
}

export function asrFailure(error: unknown, signal?: AbortSignal, closed = false): {
  outcome: "error" | "timeout" | "cancelled";
  asr_reason: AsrReason;
  provider_code?: number;
} {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  const reason = signal?.reason;
  if (reason instanceof AsrUserCancellation || error instanceof AsrUserCancellation) {
    return { outcome: "cancelled", asr_reason: "user_cancelled" };
  }
  if (reason?.name === "TimeoutError") return { outcome: "timeout", asr_reason: "timeout" };
  if (closed || signal?.aborted || name === "AbortError") return { outcome: "cancelled", asr_reason: "cancelled" };
  if (name === "TimeoutError") return { outcome: "timeout", asr_reason: "timeout" };
  const code = (error as { providerCode?: unknown } | null)?.providerCode;
  if (typeof code === "number" && Number.isInteger(code) && code > 0 && code <= 99_999) {
    return { outcome: "error", asr_reason: "provider_error", provider_code: code };
  }
  if (name === "AsrQuotaError") return { outcome: "error", asr_reason: "quota_cooldown" };
  if (name === "IncompleteTranscriptionError") return { outcome: "error", asr_reason: "incomplete" };
  const message = error instanceof Error ? error.message : "";
  if (/timed? ?out|超时/i.test(message)) return { outcome: "timeout", asr_reason: "timeout" };
  if (/disconnect|closed|network|fetch|connection (?:failed|error)/i.test(message)) return { outcome: "error", asr_reason: "disconnect" };
  if (/no (audio|transcript)|empty/i.test(message)) return { outcome: "error", asr_reason: "empty" };
  if (/unavailable|cooling down/i.test(message)) return { outcome: "error", asr_reason: "unavailable" };
  if (/asr failed/i.test(message)) return { outcome: "error", asr_reason: "http_error" };
  return { outcome: "error", asr_reason: "unknown" };
}
