import type { AsrStream, AsrStreamCallbacks } from "./asrStream";
import { getToken, getAuthGeneration, assertAuthGeneration } from "./authToken";
import { getClientId } from "./clientId";
import { withTimeout } from "./requestTimeout";
import { bindInteraction, getInteraction, measureAsrStream, traceHeaders } from "./telemetry";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const FRAME = 1280;
let unavailableUntil = 0;

/** One provider session per utterance; signed handshakes are memory-only. */
export async function openDirectAsrStream(cb: AsrStreamCallbacks, language = "en_us", signal?: AbortSignal): Promise<AsrStream> {
  const generation = getAuthGeneration();
  assertAuthGeneration(generation, signal);
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
    const url = new URL(session.url);
    if (url.protocol !== "wss:" || url.hostname !== "iat-api.xfyun.cn" || url.pathname !== "/v2/iat" || !session.app_id) throw new Error("Invalid ASR destination");
    assertAuthGeneration(generation, signal);

    return await new Promise<AsrStream>((resolve, reject) => {
      const ws = new WebSocket(session.url);
      let ready = false;
      let retired = false;
      let first = true;
      let pending = new Uint8Array(0);
      let pendingFinal: ((text: string) => void) | null = null;
      let finalTimer: ReturnType<typeof setTimeout> | undefined;
      const segments = new Map<number, string>();

      const settle = (text: string) => {
        clearTimeout(finalTimer); finalTimer = undefined;
        const done = pendingFinal; pendingFinal = null; done?.(text);
      };
      const close = () => {
        if (retired) return;
        retired = true;
        clearTimeout(readyTimer); settle("");
        signal?.removeEventListener("abort", close);
        try { ws.close(); } catch { /* already disconnected */ }
        if (ready) cb.onClose?.();
        else reject(signal?.reason ?? (generation !== getAuthGeneration()
          ? new DOMException("Identity changed", "AbortError") : new Error("ASR connection closed")));
      };
      const cancelled = () => {
        if (!signal?.aborted && generation === getAuthGeneration()) return false;
        close();
        return true;
      };
      const fail = () => {
        if (retired) return;
        if (!signal?.aborted && generation === getAuthGeneration()) unavailableUntil = Date.now() + 30_000;
        close();
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
          } catch { fail(); }
        },
        finishUtterance: () => new Promise<string>((done) => {
          if (cancelled() || retired || pendingFinal) { done(""); return; }
          pendingFinal = done;
          try {
            if (pending.length) { sendFrame(pending); pending = new Uint8Array(0); }
            if (first) { close(); return; }
            ws.send(JSON.stringify({ data: { status: 2, audio: "" } }));
            finalTimer = setTimeout(fail, 5_000);
          } catch { fail(); }
        }),
        close,
      };
      ws.onopen = () => { if (cancelled() || retired) return; ready = true; clearTimeout(readyTimer); resolve(api); };
      ws.onmessage = (event) => {
        if (cancelled() || retired) return;
        try {
          const message = JSON.parse(String(event.data));
          if (message.code !== 0) { fail(); return; }
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
        } catch { fail(); }
      };
      ws.onerror = fail;
      ws.onclose = () => {
        if (retired) return;
        if (ready && first) close(); // an unused idle session is not a network failure
        else fail();
      };
      const readyTimer = setTimeout(fail, 2_500);
      signal?.addEventListener("abort", close, { once: true });
      if (signal?.aborted) close();
    });
  } catch (error) {
    if (!signal?.aborted && generation === getAuthGeneration() && !((error instanceof Error || error instanceof DOMException) && error.name === "AbortError")) unavailableUntil = Date.now() + 30_000;
    throw error;
  }
}

/** Upload a retained complete clip directly; callers retain their relay fallback. */
export async function transcribeDirect(pcm: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  const generation = getAuthGeneration();
  let disconnected = false;
  const stream = measureAsrStream(await openDirectAsrStream({ onPartial: () => undefined, onClose: () => { disconnected = true; } }, "en_us", signal), "direct", signal);
  bindInteraction(stream, getInteraction(signal));
  try {
    assertAuthGeneration(generation, signal);
    for (let offset = 0; offset < pcm.byteLength; offset += FRAME) {
      assertAuthGeneration(generation, signal);
      if (disconnected) throw new Error("Direct ASR disconnected");
      stream.send(pcm.slice(offset, offset + FRAME));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assertAuthGeneration(generation, signal);
    const text = await stream.finishUtterance();
    assertAuthGeneration(generation, signal);
    if (!text) throw new Error("Direct ASR returned no transcript");
    return text;
  } finally { stream.close(); }
}
