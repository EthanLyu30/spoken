import type { AsrStream } from "./asrStream";

type Operation = "asr.transcribe" | "asr.finalize" | "speech.first_audio" | "speech.complete" | "voice.first_audio" | "voice.complete";
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
} = {}): void {
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 300_000) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    void Promise.resolve(fetch(`${BASE}/api/telemetry/client`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, duration_ms: durationMs, outcome: options.outcome ?? "ok",
        release: import.meta.env.VITE_RELEASE ?? "unknown",
        engine: options.engine ?? "unknown", transport: options.transport ?? "unknown",
        ...(options.interactionId && /^[a-f0-9]{32}$/.test(options.interactionId) ? { interaction_id: options.interactionId } : {}) }),
      signal: controller.signal, keepalive: true,
    })).catch(() => undefined).finally(() => clearTimeout(timer));
  } catch { clearTimeout(timer); /* instrumentation must not affect recording or playback */ }
}

export function measureAsrStream(stream: AsrStream, transport: "direct" | "relay"): AsrStream {
  const measured: AsrStream = {
    send: (pcm) => stream.send(pcm), close: () => stream.close(),
    finishUtterance: async () => {
      const start = performance.now();
      const interactionId = getInteraction(measured);
      try {
        const text = await stream.finishUtterance();
        reportTiming("asr.finalize", performance.now() - start, { engine: "xfyun", transport, interactionId, outcome: text.trim() ? "ok" : "error" });
        return text;
      } catch (error) {
        reportTiming("asr.finalize", performance.now() - start, { engine: "xfyun", transport, interactionId,
          outcome: error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "error" });
        throw error;
      }
    },
  };
  return measured;
}
