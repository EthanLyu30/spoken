import type { AsrStream } from "./asrStream";

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
  stage?: "authorize" | "open" | "stream_final" | "whole_clip" | "http_buffered";
  attempt?: number;
  fallback_reason?: "none" | "timeout" | "disconnect" | "provider_error" | "empty" | "http_error" | "unavailable" | "unknown";
  audio_bytes?: number;
  result_class?: "empty" | "nonempty";
}
interface PronunciationDiagnostic {
  entry?: "turn_correction" | "follow_read";
  audio_bytes?: number;
}
type Operation = "asr.transcribe" | "asr.finalize" | "asr.attempt" | "speech.first_audio" | "speech.playback" | "speech.complete" | "voice.first_audio" | "voice.complete"
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
export function traceHeaders(target?: object | null): Record<string, string> {
  const id = getInteraction(target);
  return id ? { "X-Interaction-Id": id } : {};
}

/** Best effort and deliberately unauthenticated: no content or identity payload. */
export function reportTiming(operation: Operation, durationMs: number, options: {
  outcome?: "ok" | "error" | "cancelled"; engine?: Engine; transport?: Transport; interactionId?: string;
  reason?: NativeDiagnostic["reason"] | NativeEndDiagnostic["reason"];
  playback_started?: boolean;
} & Omit<NativeDiagnostic, "reason"> & Omit<NativeEndDiagnostic, "reason"> & AsrAttemptDiagnostic & PronunciationDiagnostic = {}): void {
  const maxDuration = operation === "speech.native_end" ? 3_600_000 : 300_000;
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > maxDuration) return;
  const diagnostics: Record<string, unknown> = {};
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
    if (["authorize", "open", "stream_final", "whole_clip", "http_buffered"].includes(options.stage ?? "")) diagnostics.stage = options.stage;
    const attempt = integer(options.attempt, 1, 10);
    if (attempt !== undefined) diagnostics.attempt = attempt;
    if (["none", "timeout", "disconnect", "provider_error", "empty", "http_error", "unavailable", "unknown"].includes(options.fallback_reason ?? "")) diagnostics.fallback_reason = options.fallback_reason;
    const audioBytes = integer(options.audio_bytes, 0, 5_760_000);
    if (audioBytes !== undefined) diagnostics.audio_bytes = audioBytes;
    if (["empty", "nonempty"].includes(options.result_class ?? "")) diagnostics.result_class = options.result_class;
  } else if (operation === "pronunciation.click_to_result" || operation === "pronunciation.stop_to_result") {
    if (["turn_correction", "follow_read"].includes(options.entry ?? "")) diagnostics.entry = options.entry;
    const audioBytes = integer(options.audio_bytes, 0, 5_760_000);
    if (audioBytes !== undefined) diagnostics.audio_bytes = audioBytes;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  const sample = { operation, duration_ms: durationMs, outcome: options.outcome ?? "ok",
    release: import.meta.env.VITE_RELEASE ?? "unknown",
    engine: options.engine ?? "unknown", transport: options.transport ?? "unknown",
    ...(options.interactionId && /^[a-f0-9]{32}$/.test(options.interactionId) ? { interaction_id: options.interactionId } : {}),
  };
  const send = (payload: object) => fetch(`${BASE}/api/telemetry/client`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    signal: controller.signal, keepalive: true,
  });
  try {
    void Promise.resolve(send({ ...sample, ...diagnostics })).then(response => {
      // A legacy server rejects the new playback fields before storing anything.
      if (response?.status === 422 && operation === "speech.complete" &&
          Object.keys(diagnostics).length > 0 && !controller.signal.aborted) return send(sample);
    }).catch(() => undefined).finally(() => clearTimeout(timer));
  } catch { clearTimeout(timer); /* instrumentation must not affect recording or playback */ }
}

export function measureAsrStream(stream: AsrStream, transport: "direct" | "relay", signal?: AbortSignal): AsrStream {
  let closed = false;
  const measured: AsrStream = {
    transport,
    send: (pcm) => stream.send(pcm), close: () => { closed = true; stream.close(); },
    finishUtterance: async () => {
      const start = performance.now();
      const interactionId = getInteraction(measured);
      try {
        const text = await stream.finishUtterance();
        reportTiming("asr.finalize", performance.now() - start, { engine: "xfyun", transport, interactionId,
          outcome: closed || signal?.aborted ? "cancelled" : text.trim() ? "ok" : "error" });
        return text;
      } catch (error) {
        reportTiming("asr.finalize", performance.now() - start, { engine: "xfyun", transport, interactionId,
          outcome: closed || signal?.aborted || (error instanceof DOMException && error.name === "AbortError") ? "cancelled" : "error" });
        throw error;
      }
    },
  };
  return measured;
}
