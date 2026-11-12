import type { AsrStream } from "./asrStream";
import { ASR_FALLBACK_REASONS, ASR_OPERATIONS, ASR_REASONS, ASR_STAGES, asrFailure, type AsrFallbackReason, type AsrReason } from "./asrDiagnostics";
import { createAsrTimingOutbox, retryAfterMs } from "./asrTelemetryOutbox";

export const NATIVE_ERRORS = ["canceled", "interrupted", "audio-busy", "audio-hardware", "network", "synthesis-unavailable", "synthesis-failed", "language-unavailable", "voice-unavailable", "text-too-long", "invalid-argument", "not-allowed", "unknown"] as const;
export interface NativeDiagnostic {
  reason?: "started" | "startup_timeout" | "end_before_start" | "speech_error" | "speak_exception" | "cancelled";
  error_code?: typeof NATIVE_ERRORS[number];
  state_before?: number; state_after?: number;
  voice_type?: "enhanced" | "remote" | "local" | "unknown";
  voice_matched?: boolean;
}
export interface NativeEndDiagnostic {
  reason?: "end" | "native_error" | "completion_timeout" | "cancelled";
  error_code?: typeof NATIVE_ERRORS[number];
  state_at_event?: number;
  watchdog_budget_ms?: number;
  pause_count?: number; resume_count?: number;
  paused_duration_ms?: number;
  visibility_state?: "visible" | "hidden" | "unknown";
}
interface AsrAttemptDiagnostic {
  stage?: typeof ASR_STAGES[number];
  attempt?: number;
  fallback_reason?: AsrFallbackReason;
  audio_bytes?: number;
  result_class?: "empty" | "nonempty";
  provider_code?: number;
  asr_reason?: AsrReason;
}
interface PronunciationDiagnostic {
  entry?: "turn_correction" | "follow_read";
  audio_bytes?: number;
}
type Operation = typeof ASR_OPERATIONS[number] | "speech.first_audio" | "speech.playback" | "speech.complete" | "voice.first_audio" | "voice.complete"
  | "chat.first_text" | "chat.complete" | "chat.tail" | "speech.request_to_audio"
  | "speech.voice_resolution" | "speech.final_text_to_audio" | "speech.native_start" | "speech.native_end" | "speech.cloud_fetch" | "speech.play_start"
  | "pronunciation.click_to_result" | "pronunciation.stop_to_result";
type Engine = "local" | "xfyun" | "browser" | "unknown";
export type Transport = "direct" | "relay" | "buffered" | "local" | "unknown";
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const interactions = new WeakMap<object, string>();
export function newInteractionId(): string | undefined {
  try { return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join(""); }
  catch { return undefined; }
}
export function bindInteraction(target: object, id?: string): void {
  if (id && /^[a-f0-9]{32}$/.test(id)) interactions.set(target, id);
}
export const getInteraction = (target?: object | null) => target ? interactions.get(target) : undefined;
function testRunId(): string | undefined {
  const value = (globalThis as { __TEST_RUN_ID__?: unknown }).__TEST_RUN_ID__;
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : undefined;
}
export function traceHeaders(target?: object | null): Record<string, string> {
  const id = getInteraction(target);
  const run = testRunId();
  return { ...(id ? { "X-Interaction-Id": id } : {}), ...(run ? { "X-Test-Run-Id": run } : {}) };
}

async function sendTiming(fetcher: typeof fetch, payload: object): Promise<Response | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetcher(`${BASE}/api/telemetry/client`, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      credentials: "omit", body: JSON.stringify(payload), signal: controller.signal, keepalive: true,
    });
  } catch { return undefined; }
  finally { clearTimeout(timer); }
}

let asrOutbox: ReturnType<typeof createAsrTimingOutbox> | undefined;

export function initializeAsrTelemetryRecovery(): () => void {
  asrOutbox?.stop();
  const outbox = createAsrTimingOutbox(async payload => sendTiming(globalThis.fetch.bind(globalThis), payload));
  asrOutbox = outbox;
  return () => {
    outbox.stop();
    if (asrOutbox === outbox) asrOutbox = undefined;
  };
}

const MAX_DEFERRED_ASR_RETRIES = 16;
let deferredAsrRetries = 0;

async function deliverTiming(sample: { operation: Operation; outcome: string }, diagnostics: Record<string, unknown>, eventId?: string) {
  const fetcher = globalThis.fetch.bind(globalThis);
  const payload = { ...sample, ...diagnostics, ...(eventId ? { event_id: eventId } : {}) };
  const response = await sendTiming(fetcher, payload);
  let status = response?.status;
  if (eventId && (status === undefined || status === 408 || status >= 500)) {
    await new Promise(resolve => setTimeout(resolve, 750));
    status = (await sendTiming(fetcher, payload))?.status;
  } else if (eventId && status === 429 && sample.operation.startsWith("asr.") && sample.outcome !== "ok" &&
      deferredAsrRetries < MAX_DEFERRED_ASR_RETRIES) {
    const delayMs = retryAfterMs(response);
    deferredAsrRetries++;
    try {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      status = (await sendTiming(fetcher, payload))?.status;
    } finally { deferredAsrRetries--; }
  }
  if (status !== 422) return;
  // Older API versions reject new fields before accepting an event.
  const legacy = { ...sample, outcome: sample.outcome === "timeout" ? "error" : sample.outcome };
  const { asr_reason: reason, ...previousDiagnostics } = diagnostics;
  if (eventId || reason !== undefined || sample.outcome === "timeout") {
    status = (await sendTiming(fetcher, { ...legacy, ...previousDiagnostics }))?.status;
  }
  if (status === 422 && sample.operation === "speech.complete" && Object.keys(previousDiagnostics).length > 0) {
    await sendTiming(fetcher, legacy);
  }
}

/** Best effort and deliberately unauthenticated: no content or identity payload. */
export function reportTiming(operation: Operation, durationMs: number, options: {
  outcome?: "ok" | "error" | "timeout" | "cancelled"; engine?: Engine; transport?: Transport; interactionId?: string;
  reason?: NativeDiagnostic["reason"] | NativeEndDiagnostic["reason"];
  playback_started?: boolean;
} & Omit<NativeDiagnostic, "reason"> & Omit<NativeEndDiagnostic, "reason"> & AsrAttemptDiagnostic & PronunciationDiagnostic = {}): void {
  const maxDuration = operation === "speech.native_end" ? 3_600_000 : 300_000;
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > maxDuration) return;
  const diagnostics: Record<string, unknown> = {};
  if (operation.startsWith("asr.")) {
    if (options.asr_reason && ASR_REASONS.includes(options.asr_reason)) diagnostics.asr_reason = options.asr_reason;
    if (typeof options.provider_code === "number" && Number.isInteger(options.provider_code) &&
        options.provider_code > 0 && options.provider_code <= 99_999) {
      diagnostics.provider_code = options.provider_code;
    }
  }
  const integer = (value: number | undefined, min: number, max: number) =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
  const numeric = (value: number | undefined, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
  if (operation === "speech.native_start" || operation === "speech.native_end" || operation === "speech.complete") {
    const startupFailures = ["startup_timeout", "end_before_start", "speech_error"];
    const reasons = operation === "speech.native_end" ? ["end", "native_error", "completion_timeout", "cancelled"]
      : operation === "speech.complete" ? startupFailures : [...startupFailures, "started", "speak_exception", "cancelled"];
    if (reasons.includes(options.reason ?? "")) diagnostics.reason = options.reason;
    if ((operation !== "speech.complete" || diagnostics.reason) && NATIVE_ERRORS.includes(options.error_code!)) diagnostics.error_code = options.error_code;
  }
  if (operation === "speech.native_start") {
    for (const key of ["state_before", "state_after"] as const) {
      const value = integer(options[key], 0, 7);
      if (value !== undefined) diagnostics[key] = value;
    }
    if (["enhanced", "remote", "local", "unknown"].includes(options.voice_type ?? "")) diagnostics.voice_type = options.voice_type;
    if (typeof options.voice_matched === "boolean") diagnostics.voice_matched = options.voice_matched;
  } else if (operation === "speech.complete") {
    if (typeof options.playback_started === "boolean") diagnostics.playback_started = options.playback_started;
    if (diagnostics.reason && ["enhanced", "remote"].includes(options.voice_type ?? "")) diagnostics.voice_type = options.voice_type;
  } else if (operation === "speech.native_end") {
    const stateAtEvent = integer(options.state_at_event, 0, 7);
    if (stateAtEvent !== undefined) diagnostics.state_at_event = stateAtEvent;
    for (const [key, value] of [
      ["watchdog_budget_ms", numeric(options.watchdog_budget_ms, 0, 3_600_000)],
      ["pause_count", integer(options.pause_count, 0, 100)],
      ["resume_count", integer(options.resume_count, 0, 100)],
      ["paused_duration_ms", numeric(options.paused_duration_ms, 0, 300_000)],
    ] as const) {
      if (value !== undefined) diagnostics[key] = value;
    }
    if (["visible", "hidden", "unknown"].includes(options.visibility_state ?? "")) diagnostics.visibility_state = options.visibility_state;
  } else if (operation === "asr.attempt") {
    if (options.stage && ASR_STAGES.includes(options.stage)) diagnostics.stage = options.stage;
    const attempt = integer(options.attempt, 1, 10);
    if (attempt !== undefined) diagnostics.attempt = attempt;
    if (options.fallback_reason && ASR_FALLBACK_REASONS.includes(options.fallback_reason)) diagnostics.fallback_reason = options.fallback_reason;
    const audioBytes = integer(options.audio_bytes, 0, 5_760_000);
    if (audioBytes !== undefined) diagnostics.audio_bytes = audioBytes;
    if (["empty", "nonempty"].includes(options.result_class ?? "")) diagnostics.result_class = options.result_class;
  } else if (operation === "pronunciation.click_to_result" || operation === "pronunciation.stop_to_result") {
    if (["turn_correction", "follow_read"].includes(options.entry ?? "")) diagnostics.entry = options.entry;
    const audioBytes = integer(options.audio_bytes, 0, 5_760_000);
    if (audioBytes !== undefined) diagnostics.audio_bytes = audioBytes;
  }
  const run = testRunId();
  const sample = { operation, duration_ms: durationMs, outcome: options.outcome ?? "ok",
    release: import.meta.env.VITE_RELEASE ?? "unknown",
    ...(run ? { test_run_id: run } : {}),
    engine: options.engine ?? "unknown", transport: options.transport ?? "unknown",
    ...(options.interactionId && /^[a-f0-9]{32}$/.test(options.interactionId) ? { interaction_id: options.interactionId } : {}),
  };
  const eventId = newInteractionId();
  if (eventId && asrOutbox && operation.startsWith("asr.") && (sample.outcome === "error" || sample.outcome === "timeout") &&
      asrOutbox.enqueue({ ...sample, ...diagnostics, event_id: eventId })) return;
  void deliverTiming(sample, diagnostics, eventId).catch(() => undefined);
}

export function measureAsrStream(stream: AsrStream, transport: "direct" | "relay", signal?: AbortSignal): AsrStream {
  let closed = false;
  const measured: AsrStream = {
    transport,
    send: (pcm) => stream.send(pcm), close: (error) => { closed = true; stream.close(error); },
    finishUtterance: async () => {
      const start = performance.now();
      const interactionId = getInteraction(measured) ?? getInteraction(signal);
      try {
        const text = await stream.finishUtterance();
        reportTiming("asr.finalize", performance.now() - start, { engine: "xfyun", transport, interactionId,
          ...(closed || signal?.aborted ? asrFailure(undefined, signal, closed)
            : text.trim() ? { outcome: "ok" } : { outcome: "error", asr_reason: "empty" }) });
        return text;
      } catch (error) {
        reportTiming("asr.finalize", performance.now() - start, { engine: "xfyun", transport, interactionId,
          ...asrFailure(error, signal, closed) });
        throw error;
      }
    },
  };
  return measured;
}
