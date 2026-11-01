import type { AsrStream } from "./asrStream";

export const NATIVE_ERRORS = ["canceled", "interrupted", "audio-busy", "audio-hardware", "network", "synthesis-unavailable", "synthesis-failed", "language-unavailable", "voice-unavailable", "text-too-long", "invalid-argument", "not-allowed", "unknown"] as const;
export interface NativeDiagnostic {
  reason?: "started" | "startup_timeout" | "end_before_start" | "speech_error" | "speak_exception" | "cancelled";
  error_code?: typeof NATIVE_ERRORS[number];
  state_before?: number; state_after?: number;
  voice_type?: "enhanced" | "remote" | "local" | "unknown";
  voice_matched?: boolean;
}
type Operation = "asr.transcribe" | "asr.finalize" | "speech.first_audio" | "speech.playback" | "speech.complete" | "voice.first_audio" | "voice.complete"
  | "chat.first_text" | "chat.complete" | "chat.tail" | "speech.request_to_audio"
  | "speech.voice_resolution" | "speech.final_text_to_audio" | "speech.native_start" | "speech.cloud_fetch" | "speech.play_start";
type Engine = "local" | "xfyun" | "browser" | "unknown";
type Transport = "direct" | "relay" | "buffered" | "local" | "unknown";
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
} & NativeDiagnostic = {}): void {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 300_000) return;
  const native: NativeDiagnostic = {};
  if (operation === "speech.native_start") {
    if (["started", "startup_timeout", "end_before_start", "speech_error", "speak_exception", "cancelled"].includes(options.reason ?? "")) native.reason = options.reason;
    if (NATIVE_ERRORS.includes(options.error_code!)) native.error_code = options.error_code;
    for (const key of ["state_before", "state_after"] as const) {
      const value = options[key];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 7) native[key] = value;
    }
    if (["enhanced", "remote", "local", "unknown"].includes(options.voice_type ?? "")) native.voice_type = options.voice_type;
    if (typeof options.voice_matched === "boolean") native.voice_matched = options.voice_matched;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    void Promise.resolve(fetch(`${BASE}/api/telemetry/client`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, duration_ms: durationMs, outcome: options.outcome ?? "ok",
        ...native, release: import.meta.env.VITE_RELEASE ?? "unknown",
        engine: options.engine ?? "unknown", transport: options.transport ?? "unknown",
        ...(options.interactionId && /^[a-f0-9]{32}$/.test(options.interactionId) ? { interaction_id: options.interactionId } : {}) }),
      signal: controller.signal, keepalive: true,
    })).catch(() => undefined).finally(() => clearTimeout(timer));
  } catch { clearTimeout(timer); /* instrumentation must not affect recording or playback */ }
}

export function measureAsrStream(stream: AsrStream, transport: "direct" | "relay", signal?: AbortSignal): AsrStream {
  let closed = false;
  const measured: AsrStream = {
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
