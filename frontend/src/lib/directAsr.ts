import type { AsrStream, AsrStreamCallbacks } from "./asrStream";
import { getToken, getAuthGeneration, assertAuthGeneration } from "./authToken";
import { getClientId } from "./clientId";
import { withTimeout } from "./requestTimeout";
import { bindInteraction, getInteraction, measureAsrStream, traceHeaders } from "./telemetry";
import { AsrQuotaError, asrProviderError, isAsrQuotaCooling } from "./asrQuota";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const FRAME = 1280;
let unavailableUntil = 0;

const cancelledError = () => new DOMException("ASR cancelled", "AbortError");

/** One provider session per utterance; signed handshakes are memory-only. */
export async function openDirectAsrStream(cb: AsrStreamCallbacks, language = "en_us", signal?: AbortSignal): Promise<AsrStream> {
  const generation = getAuthGeneration();
  assertAuthGeneration(generation, signal);
  if (isAsrQuotaCooling()) throw new AsrQuotaError();
  if (Date.now() < unavailableUntil) throw new Error("Direct ASR is cooling down");
  try {
    const token = getToken();
    const headers = { "X-Client-Id": getClientId(), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...traceHeaders(signal) };
    assertAuthGeneration(generation, signal);
    const response = await fetch(`${BASE_URL}/api/asr/session`, {
      method: "POST", headers,
      signal: withTimeout(signal, 3_000), cache: "no-store",
    });
    assertAuthGeneration(generation, signal);
    if (!response.ok) throw new Error("ASR authorization unavailable");
    const session = await response.json() as { url: string; app_id: string };
    assertAuthGeneration(generation, signal);
    // Another request may have exhausted the same AppID's quota while this
    // signature request was in flight; never open a new provider socket.
    if (isAsrQuotaCooling()) throw new AsrQuotaError();
    const url = new URL(session.url);
    if (url.protocol !== "wss:" || url.hostname !== "iat-api.xfyun.cn" || url.pathname !== "/v2/iat" || !session.app_id) throw new Error("Invalid ASR destination");
    assertAuthGeneration(generation, signal);

    return await new Promise<AsrStream>((resolve, reject) => {
      const ws = new WebSocket(session.url);
      let ready = false;
      let retired = false;
      let first = true;
      let pending = new Uint8Array(0);
      let pendingFinal: { resolve: (text: string) => void; reject: (error: unknown) => void } | null = null;
      let finalTimer: ReturnType<typeof setTimeout> | undefined;
      let terminalError: unknown;
      const segments = new Map<number, string>();

      const settle = (text = "", error?: unknown) => {
        clearTimeout(finalTimer); finalTimer = undefined;
        const done = pendingFinal; pendingFinal = null;
        if (error) done?.reject(error); else done?.resolve(text);
      };
      const close = (error?: unknown) => {
        if (retired) return;
        retired = true;
        clearTimeout(readyTimer);
        const cancelled = signal?.aborted || generation !== getAuthGeneration();
        const reason = error ?? (cancelled ? cancelledError() : new Error("ASR connection closed"));
        terminalError = reason;
        if (pendingFinal) settle("", reason);
        signal?.removeEventListener("abort", onAbort);
        try { ws.close(); } catch { /* already disconnected */ }
        if (ready) cb.onClose?.(reason);
        else reject(reason);
      };
      const onAbort = () => close(cancelledError());
      const cancelled = () => {
        if (!signal?.aborted && generation === getAuthGeneration()) return false;
        close(cancelledError());
        return true;
      };
      const fail = (failure: string | Error = "ASR connection failed") => {
        if (retired) return;
        if (!signal?.aborted && generation === getAuthGeneration()) unavailableUntil = Date.now() + 30_000;
        close(typeof failure === "string" ? new Error(failure) : failure);
      };
      const sendFrame = (pcm: Uint8Array) => {
        const data = { status: first ? 0 : 1, format: "audio/L16;rate=16000", encoding: "raw", audio: btoa(String.fromCharCode(...pcm)) };
        const frame: Record<string, unknown> = { data };
        if (first) {
          frame.common = { app_id: session.app_id };
          frame.business = { language, domain: "iat", accent: "mandarin", vad_eos: 10000, ...(language === "zh_cn" ? { dwa: "wpgs" } : {}) };
          first = false;
        }
        ws.send(JSON.stringify(frame));
      };
      const api: AsrStream = {
        send: (pcm) => {
          if (cancelled() || retired || ws.readyState !== WebSocket.OPEN) return;
          const joined = new Uint8Array(pending.length + pcm.byteLength);
          joined.set(pending); joined.set(new Uint8Array(pcm), pending.length); pending = joined;
          try {
            while (pending.length >= FRAME) { sendFrame(pending.slice(0, FRAME)); pending = pending.slice(FRAME); }
          } catch { fail("ASR upload failed"); }
        },
        finishUtterance: () => new Promise<string>((resolveFinal, rejectFinal) => {
          if (pendingFinal) { rejectFinal(new Error("ASR final is already pending")); return; }
          if (cancelled()) { rejectFinal(cancelledError()); return; }
          if (retired) {
            rejectFinal(terminalError instanceof Error ? terminalError : new Error("ASR connection closed"));
            return;
          }
          pendingFinal = { resolve: resolveFinal, reject: rejectFinal };
          try {
            if (pending.length) { sendFrame(pending); pending = new Uint8Array(0); }
            if (first) { close(new Error("ASR returned no audio")); return; }
            ws.send(JSON.stringify({ data: { status: 2, audio: "" } }));
            finalTimer = setTimeout(() => fail("ASR final timed out"), 5_000);
          } catch { fail("ASR finalization failed"); }
        }),
        close: () => close(),
      };
      ws.onopen = () => { if (cancelled() || retired) return; ready = true; clearTimeout(readyTimer); resolve(api); };
      ws.onmessage = (event) => {
        if (cancelled() || retired) return;
        try {
          const message = JSON.parse(String(event.data));
          if (message.code !== 0) {
            const code = Number(message.code);
            fail(asrProviderError(Number.isFinite(code) ? code : 0,
              typeof message.message === "string" ? message.message : ""));
            return;
          }
          const data = message.data ?? {};
          const result = data.result;
          if (result?.ws?.length) {
            if (result.pgs === "rpl" && Array.isArray(result.rg)) {
              for (const sn of segments.keys()) if (sn >= result.rg[0] && sn <= result.rg[1]) segments.delete(sn);
            }
            const text = result.ws.map((part: { cw: { w?: string }[] }) => part.cw.map(word => word.w ?? "").join("")).join("");
            const sn = typeof result.sn === "number" ? result.sn : Math.max(-1, ...segments.keys()) + 1;
            segments.set(sn, text);
            cb.onPartial([...segments].sort((a,b) => a[0]-b[0]).map(item => item[1]).join("").trim());
          }
          if (data.status === 2) {
            settle([...segments].sort((a,b) => a[0]-b[0]).map(item => item[1]).join("").trim());
            close();
          }
        } catch { fail("ASR response invalid"); }
      };
      ws.onerror = () => fail("ASR network error");
      ws.onclose = () => {
        if (retired) return;
        if (ready && first) close(); // an unused idle session is not a network failure
        else fail("ASR connection closed");
      };
      const readyTimer = setTimeout(() => fail("ASR connection timed out"), 2_500);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) close(cancelledError());
    });
  } catch (error) {
    if (!signal?.aborted && generation === getAuthGeneration() && !((error instanceof Error || error instanceof DOMException) && error.name === "AbortError")) unavailableUntil = Date.now() + 30_000;
    throw error;
  }
}

/** Upload a retained complete clip directly; a real empty final is not a transport failure. */
export async function transcribeDirect(pcm: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  const generation = getAuthGeneration();
  let disconnected: unknown = null;
  const stream = measureAsrStream(await openDirectAsrStream({ onPartial: () => undefined, onClose: (error) => { disconnected = error ?? true; } }, "en_us", signal), "direct", signal);
  bindInteraction(stream, getInteraction(signal));
  try {
    assertAuthGeneration(generation, signal);
    for (let offset = 0; offset < pcm.byteLength; offset += FRAME) {
      assertAuthGeneration(generation, signal);
      if (disconnected) throw disconnected instanceof Error ? disconnected : new Error("Direct ASR disconnected");
      stream.send(pcm.slice(offset, offset + FRAME));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assertAuthGeneration(generation, signal);
    const text = await stream.finishUtterance();
    assertAuthGeneration(generation, signal);
    return text;
  } finally { stream.close(); }
}
