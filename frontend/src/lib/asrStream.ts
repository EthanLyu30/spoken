/**
 * Streaming ASR client for call mode. Direct iFlytek is preferred; the backend
 * relay remains a bounded fallback when the direct connection cannot open.
 */
import { openDirectAsrStream } from "./directAsr";
import { bindInteraction, getInteraction, measureAsrStream, reportTiming, traceHeaders } from "./telemetry";
import { assertAuthGeneration, getAuthGeneration } from "./authToken";
import { AsrQuotaError, asrProviderError, isAsrQuotaCooling, isAsrQuotaError } from "./asrQuota";
import { asrFailure, asrFallbackReason, type AsrFallbackReason } from "./asrDiagnostics";

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
  onClose?: (error?: unknown) => void;
}

const READY_TIMEOUT_MS = 5000;
const FINAL_TIMEOUT_MS = 8000;
const cancelledError = () => new DOMException("ASR cancelled", "AbortError");

function relayProviderError(message: string, code?: unknown): Error {
  const numeric = Number(typeof code === "number" || typeof code === "string"
    ? code : message.match(/iFlytek ASR error (\d{1,5})\b/)?.[1]);
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 99_999
    ? asrProviderError(numeric, message)
    : new Error(message || "ASR connection error");
}

/** Direct→relay is allowed only while opening; later failures use complete PCM. */
export async function openAsrStream(cb: AsrStreamCallbacks, language = "en_us", signal?: AbortSignal): Promise<AsrStream> {
  const generation = getAuthGeneration();
  assertAuthGeneration(generation, signal);
  if (isAsrQuotaCooling()) throw new AsrQuotaError();
  const interactionId = getInteraction(signal);

  async function openRoute(
    transport: "direct" | "relay",
    attempt: number,
    connect: typeof openDirectAsrStream,
    fallbackReason?: AsrFallbackReason,
  ): Promise<AsrStream> {
    const started = performance.now();
    const route = { engine: "xfyun", transport, attempt, fallback_reason: fallbackReason } as const;
    let stream: AsrStream | undefined;
    let activeAt: number | undefined;
    const turnId = () => getInteraction(stream) ?? interactionId;
    try {
      const raw = await connect({
        onPartial: cb.onPartial,
        onClose(error) {
          if (error && activeAt !== undefined) {
            const failure = asrFailure(error, signal, generation !== getAuthGeneration());
            if (failure.outcome !== "cancelled") {
              reportTiming("asr.attempt", performance.now() - activeAt, {
                ...route, stage: "stream", interactionId: turnId(), ...failure,
              });
            }
          }
          activeAt = undefined;
          cb.onClose?.(error);
        },
      }, language, signal);
      try { assertAuthGeneration(generation, signal); }
      catch (error) { raw.close(); throw error; }
      reportTiming("asr.attempt", performance.now() - started, {
        ...route, interactionId, stage: "open", outcome: "ok",
      });

      const measured = measureAsrStream(raw, transport, signal);
      const bindTurn = () => {
        const id = turnId();
        bindInteraction(raw, id);
        bindInteraction(measured, id);
      };
      activeAt = performance.now();
      stream = {
        transport,
        send(pcm) {
          activeAt ??= performance.now();
          bindTurn();
          measured.send(pcm);
        },
        finishUtterance() {
          activeAt = undefined;
          bindTurn();
          return measured.finishUtterance();
        },
        close(error) {
          activeAt = undefined;
          measured.close(error);
        },
      };
      return stream;
    } catch (error) {
      reportTiming("asr.attempt", performance.now() - started, {
        ...route, interactionId, stage: "open", ...asrFailure(error, signal, generation !== getAuthGeneration()),
      });
      throw error;
    }
  }

  try {
    return await openRoute("direct", 1, openDirectAsrStream);
  } catch (error) {
    if (isAsrQuotaError(error)) throw error;
    assertAuthGeneration(generation, signal);
    const failure = asrFailure(error, signal);
    if (failure.outcome === "cancelled") throw error;
    if (isAsrQuotaCooling()) throw new AsrQuotaError();
    return openRoute("relay", 2, openRelayAsrStream, asrFallbackReason(failure.asr_reason));
  }
}

export function openRelayAsrStream(
  cb: AsrStreamCallbacks,
  language = "en_us",
  signal?: AbortSignal,
): Promise<AsrStream> {
  if (isAsrQuotaCooling()) return Promise.reject(new AsrQuotaError());
  const generation = getAuthGeneration();
  return new Promise<AsrStream>((resolve, reject) => {
    assertAuthGeneration(generation, signal);
    const ws = new WebSocket(streamUrl());
    ws.binaryType = "arraybuffer";

    let ready = false;
    let retired = false;
    let tracing = false;
    let turnSent = false;
    let pendingFinal: { resolve: (text: string) => void; reject: (error: unknown) => void } | null = null;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    let terminalError: unknown;

    const settlePending = (text = "", error?: unknown) => {
      clearTimeout(finalTimer);
      finalTimer = undefined;
      const pending = pendingFinal;
      pendingFinal = null;
      if (error) pending?.reject(error); else pending?.resolve(text);
    };

    const retire = (error?: unknown, notifyServer = false) => {
      if (retired) return;
      retired = true;
      clearTimeout(readyTimer);
      signal?.removeEventListener("abort", onAbort);
      terminalError = error ?? new Error("ASR connection closed");
      settlePending("", terminalError);
      if (notifyServer && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "close" })); } catch { /* already closed */ }
      }
      try { ws.close(); } catch { /* already closed */ }
      if (ready) cb.onClose?.(error);
      else reject(terminalError);
    };

    const cancelled = () => {
      try {
        assertAuthGeneration(generation, signal);
        return false;
      } catch (error) {
        retire(error, true);
        return true;
      }
    };
    const onAbort = () => { cancelled(); };
    const sendTurn = () => {
      if (!tracing || turnSent) return;
      turnSent = true;
      const headers = traceHeaders(getInteraction(api) ? api : signal);
      const interaction = headers["X-Interaction-Id"];
      const run = headers["X-Test-Run-Id"];
      if (interaction) {
        ws.send(JSON.stringify({ type: "turn", interaction_id: interaction, ...(run ? { test_run_id: run } : {}) }));
      }
    };

    const api: AsrStream = {
      send(pcm) {
        if (cancelled() || retired || ws.readyState !== WebSocket.OPEN) return;
        try {
          sendTurn();
          ws.send(pcm);
        } catch { retire(new Error("ASR connection error")); }
      },
      finishUtterance: () => new Promise<string>((resolveFinal, rejectFinal) => {
        if (pendingFinal) { rejectFinal(new Error("ASR final is already pending")); return; }
        if (cancelled()) { rejectFinal(signal?.reason ?? cancelledError()); return; }
        if (retired || ws.readyState !== WebSocket.OPEN) {
          rejectFinal(terminalError ?? new Error("ASR connection closed"));
          return;
        }
        pendingFinal = { resolve: resolveFinal, reject: rejectFinal };
        try {
          sendTurn();
          ws.send(JSON.stringify({ type: "end" }));
        } catch {
          retire(new Error("ASR connection error"));
          return;
        }
        finalTimer = setTimeout(() => {
          if (pendingFinal) retire(new DOMException("ASR final timed out", "TimeoutError"));
        }, FINAL_TIMEOUT_MS);
      }),
      close: error => retire(error, true),
    };

    ws.onopen = () => {
      if (cancelled() || retired) return;
      try { ws.send(JSON.stringify({ type: "start", language, trace_context: true })); }
      catch { retire(new Error("ASR connection error")); }
    };

    ws.onmessage = (ev) => {
      if (cancelled() || retired) return;
      let msg: { type?: string; text?: string; message?: string; code?: unknown; trace_context?: boolean } | null;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); }
      catch { return; }
      if (!msg) return;
      if (msg.type === "error") {
        retire(relayProviderError(msg.message ?? "", msg.code));
      } else if (!ready && msg.type === "ready") {
        ready = true;
        tracing = msg.trace_context === true;
        clearTimeout(readyTimer);
        resolve(api);
      } else if (ready && msg.type === "partial") {
        cb.onPartial(msg.text ?? "");
      } else if (ready && msg.type === "final") {
        turnSent = false;
        settlePending(msg.text ?? "");
      }
    };

    ws.onerror = () => retire(new Error("ASR connection error"));
    ws.onclose = () => retire(new Error(ready ? "ASR connection closed" : "ASR stream closed before ready"));
    const readyTimer = setTimeout(() => retire(new DOMException("ASR handshake timed out", "TimeoutError")), READY_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
