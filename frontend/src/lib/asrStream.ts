/**
 * Streaming ASR client for call mode. Direct iFlytek is preferred; the backend
 * relay remains a bounded fallback when the direct connection cannot open.
 */
import { openDirectAsrStream } from "./directAsr";
import { getInteraction, measureAsrStream, reportTiming } from "./telemetry";
import { assertAuthGeneration, getAuthGeneration } from "./authToken";
import { AsrQuotaError, isAsrQuotaCooling, isAsrQuotaError } from "./asrQuota";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

function streamUrl(): string {
  const path = "/api/asr/stream";
  if (BASE_URL) return BASE_URL.replace(/^http/, "ws") + path;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

export interface AsrStream {
  readonly transport?: "direct" | "relay";
  send: (pcm: ArrayBuffer) => void;
  finishUtterance: () => Promise<string>;
  close: (error?: unknown) => void;
}

export interface AsrStreamCallbacks {
  onPartial: (text: string) => void;
  onClose?: () => void;
}

const READY_TIMEOUT_MS = 5000;
const FINAL_TIMEOUT_MS = 8000;
const cancelledError = () => new DOMException("ASR cancelled", "AbortError");

/** Direct→relay is allowed only while opening; later failures use complete PCM. */
export async function openAsrStream(cb: AsrStreamCallbacks, language = "en_us", signal?: AbortSignal): Promise<AsrStream> {
  const generation = getAuthGeneration();
  assertAuthGeneration(generation, signal);
  if (isAsrQuotaCooling()) throw new AsrQuotaError();
  const interactionId = getInteraction(signal);
  const directStarted = performance.now();
  try {
    const stream = await openDirectAsrStream(cb, language, signal);
    try { assertAuthGeneration(generation, signal); }
    catch (error) { stream.close(); throw error; }
    reportTiming("asr.attempt", performance.now() - directStarted, {
      engine: "xfyun", transport: "direct", interactionId, stage: "open", attempt: 1, outcome: "ok",
    });
    return measureAsrStream(stream, "direct", signal);
  } catch (error) {
    if (isAsrQuotaError(error)) throw error;
    const cancelled = signal?.aborted || generation !== getAuthGeneration() ||
      ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError");
    reportTiming("asr.attempt", performance.now() - directStarted, {
      engine: "xfyun", transport: "direct", interactionId, stage: "open", attempt: 1,
      outcome: cancelled ? "cancelled" : "error", fallback_reason: "unavailable",
    });
    assertAuthGeneration(generation, signal);
    signal?.throwIfAborted();
    if ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError") throw error;
  }
  const relayStarted = performance.now();
  try {
    const stream = await openRelayAsrStream(cb, language, signal);
    try { assertAuthGeneration(generation, signal); }
    catch (error) { stream.close(); throw error; }
    reportTiming("asr.attempt", performance.now() - relayStarted, {
      engine: "xfyun", transport: "relay", interactionId, stage: "open", attempt: 2,
      outcome: "ok", fallback_reason: "unavailable",
    });
    return measureAsrStream(stream, "relay", signal);
  } catch (error) {
    reportTiming("asr.attempt", performance.now() - relayStarted, {
      engine: "xfyun", transport: "relay", interactionId, stage: "open", attempt: 2,
      outcome: signal?.aborted ? "cancelled" : "error", fallback_reason: "unavailable",
    });
    throw error;
  }
}

export function openRelayAsrStream(
  cb: AsrStreamCallbacks,
  language = "en_us",
  signal?: AbortSignal,
): Promise<AsrStream> {
  const generation = getAuthGeneration();
  return new Promise<AsrStream>((resolve, reject) => {
    let ws: WebSocket;
    try {
      assertAuthGeneration(generation, signal);
      ws = new WebSocket(streamUrl());
    } catch (err) {
      reject(err);
      return;
    }
    ws.binaryType = "arraybuffer";

    let ready = false;
    let closeNotified = false;
    let pendingFinal: { resolve: (text: string) => void; reject: (error: unknown) => void } | null = null;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;

    const settlePending = (text = "", error?: unknown) => {
      clearTimeout(finalTimer);
      finalTimer = undefined;
      const pending = pendingFinal;
      pendingFinal = null;
      if (error) pending?.reject(error); else pending?.resolve(text);
    };

    const notifyClose = () => {
      if (closeNotified) return;
      closeNotified = true;
      cb.onClose?.();
    };

    const readyTimer = setTimeout(() => {
      if (!ready) {
        try { ws.close(); } catch { /* already closed */ }
        reject(new Error("asr stream handshake timed out"));
      }
    }, READY_TIMEOUT_MS);

    const cancelled = () => {
      try {
        assertAuthGeneration(generation, signal);
        return false;
      } catch (error) {
        reject(error);
        api.close(error);
        return true;
      }
    };
    const onAbort = () => { cancelled(); };

    const api: AsrStream = {
      send: (pcm) => {
        if (cancelled()) return;
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(pcm); } catch { /* a dropped frame is recovered from complete PCM */ }
        }
      },
      finishUtterance: () => new Promise<string>((resolveFinal, rejectFinal) => {
        if (pendingFinal) { rejectFinal(new Error("ASR final is already pending")); return; }
        if (cancelled()) { rejectFinal(cancelledError()); return; }
        if (ws.readyState !== WebSocket.OPEN) { rejectFinal(new Error("ASR connection closed")); return; }
        pendingFinal = { resolve: resolveFinal, reject: rejectFinal };
        try {
          ws.send(JSON.stringify({ type: "end" }));
        } catch (error) {
          settlePending("", error);
          return;
        }
        finalTimer = setTimeout(() => {
          if (!pendingFinal) return;
          const error = new Error("ASR final timed out");
          settlePending("", error);
          try { ws.close(); } catch { /* already closed */ }
          notifyClose();
        }, FINAL_TIMEOUT_MS);
      }),
      close: (error?: unknown) => {
        clearTimeout(readyTimer);
        signal?.removeEventListener("abort", onAbort);
        settlePending("", error ?? new Error("ASR connection closed"));
        try { ws.send(JSON.stringify({ type: "close" })); } catch { /* already closed */ }
        try { ws.close(); } catch { /* already closed */ }
      },
    };

    ws.onopen = () => {
      if (cancelled()) return;
      try { ws.send(JSON.stringify({ type: "start", language })); } catch { /* onclose rejects */ }
    };

    ws.onmessage = (ev) => {
      if (cancelled()) return;
      let msg: { type?: string; text?: string; message?: string };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch { return; }
      if (!ready) {
        if (msg.type === "ready") {
          ready = true;
          clearTimeout(readyTimer);
          resolve(api);
        } else if (msg.type === "error") {
          clearTimeout(readyTimer);
          try { ws.close(); } catch { /* already closed */ }
          reject(new Error(msg.message || "asr stream unavailable"));
        }
        return;
      }
      if (msg.type === "partial") cb.onPartial(msg.text ?? "");
      else if (msg.type === "final") settlePending(msg.text ?? "");
      else if (msg.type === "error") api.close(new Error("ASR provider error"));
    };

    ws.onerror = () => {
      if (!ready) {
        clearTimeout(readyTimer);
        reject(new Error("asr stream connection error"));
      }
    };

    ws.onclose = () => {
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(readyTimer);
      settlePending("", signal?.aborted ? cancelledError() : new Error("ASR connection closed"));
      if (ready) notifyClose();
      else reject(new Error("asr stream closed before ready"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
