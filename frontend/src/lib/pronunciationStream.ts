import type { PronunciationResult } from "./api";
import { assertAuthGeneration, getAuthGeneration, subscribeAuthGeneration } from "./authToken";
import { MAX_AUDIO_BYTES } from "./audioLimits";
export interface PronunciationStream {
  send: (pcm: ArrayBuffer) => void;
  /** null means the provider never became ready; buffered POST is then safe. */
  finish: () => Promise<PronunciationResult | null>;
  close: () => void;
}
type Outcome = {
  result: PronunciationResult;
} | {
  error: Error;
} | {
  fallback: true;
};
const MAX_BUFFER_BYTES = 384 * 1024;
const MAX_FRAME_BYTES = 64 * 1024;
function streamUrl() {
  const base = import.meta.env.VITE_API_BASE_URL ?? "";
  const url = new URL(base ? base.replace(/\/$/, "") + "/api/pronunciation/stream" : "/api/pronunciation/stream", location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}
/** One assessment. All background outcomes are handled before finish is called. */
export function createPronunciationStream(text: string, signal?: AbortSignal, onError?: (error: Error) => void, entry: "follow_read" = "follow_read"): PronunciationStream {
  const generation = getAuthGeneration();
  let socket: WebSocket | undefined, ready = false, finished = false, ended = false, settled = false;
  let total = 0, queuedBytes = 0;
  let startupBacklogMs = 0;
  let queue: ArrayBuffer[] = [];
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let finalTimer: ReturnType<typeof setTimeout> | undefined;
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = () => { };
  let resolve!: (outcome: Outcome) => void;
  // Resolve an outcome rather than rejecting before the learner presses Stop.
  const outcome = new Promise<Outcome>(r => { resolve = r; });
  function settle(value: Outcome) {
    if (settled)
      return;
    settled = true;
    clearTimeout(readyTimer);
    clearTimeout(finalTimer);
    clearTimeout(overallTimer);
    signal?.removeEventListener("abort", abort);
    unsubscribe();
    queue = [];
    queuedBytes = 0;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      }
      catch { /* already closed */ }
    }
    resolve(value);
    if ("error" in value)
      onError?.(value.error);
  }
  function fail(message: string, canFallback = !ready) { settle(canFallback ? { fallback: true } : { error: new Error(message) }); }
  function abort() { settle({ error: new DOMException("Assessment cancelled", "AbortError") }); }
  function current() {
    try {
      assertAuthGeneration(generation, signal);
      return true;
    }
    catch {
      abort();
      return false;
    }
  }
  function sendFrame(frame: ArrayBuffer) {
    if (!socket || socket.readyState !== WebSocket.OPEN)
      throw new Error("Pronunciation stream disconnected");
    if (socket.bufferedAmount + frame.byteLength > MAX_BUFFER_BYTES)
      throw new Error("Pronunciation upload is too slow");
    socket.send(frame);
  }
  function end() {
    if (!ready || !finished || ended || settled)
      return;
    if (!total) {
      fail("没有录到声音，请重试。", false);
      return;
    }
    try {
      if (!socket || socket.readyState !== WebSocket.OPEN)
        throw new Error("Pronunciation stream disconnected");
      socket.send(JSON.stringify({ type: "end" }));
      ended = true;
      // The provider keeps real-time pacing. Audio captured before readiness
      // can still be uploading after Stop, before its final-result wait begins.
      finalTimer = setTimeout(() => fail("Pronunciation result timed out", false), 20000 + startupBacklogMs);
    }
    catch (error) {
      settle({ error: error instanceof Error ? error : new Error("Pronunciation stream failed") });
    }
  }
  const api: PronunciationStream = {
    send(pcm) {
      if (settled || !current() || finished || !pcm.byteLength)
        return;
      total += pcm.byteLength;
      if (pcm.byteLength % 2 || total > MAX_AUDIO_BYTES) {
        fail("录音最长180秒，请缩短后重试。", false);
        return;
      }
      for (let offset = 0;offset < pcm.byteLength;offset += MAX_FRAME_BYTES) {
        const frame = pcm.slice(offset, Math.min(offset + MAX_FRAME_BYTES, pcm.byteLength));
        if (!ready) {
          queuedBytes += frame.byteLength;
          if (queuedBytes > MAX_BUFFER_BYTES) {
            fail("Pronunciation startup queue full");
            return;
          }
          queue.push(frame);
        }
        else {
          try {
            sendFrame(frame);
          }
          catch (error) {
            settle({ error: error instanceof Error ? error : new Error("Pronunciation upload failed") });
            return;
          }
        }
      }
    },
    finish() {
      current();
      finished = true;
      end();
      return outcome.then(value => {
        assertAuthGeneration(generation, signal);
        if ("error" in value)
          throw value.error;
        return "result" in value ? value.result : null;
      });
    },
    close: abort,
  };
  try {
    assertAuthGeneration(generation, signal);
    if (!text.trim() || Array.from(text).length > 2000) {
      fail("跟读文本需要1–2000个字符。", false);
      return api;
    }
    signal?.addEventListener("abort", abort, { once: true });
    unsubscribe = subscribeAuthGeneration(() => {
      if (generation !== getAuthGeneration())
        abort();
    });
    socket = new WebSocket(streamUrl());
    socket.binaryType = "arraybuffer";
    readyTimer = setTimeout(() => fail("Pronunciation startup timed out"), 12000);
    overallTimer = setTimeout(() => fail("Pronunciation assessment timed out", false), 210000);
    socket.onopen = () => {
      if (settled || !current())
        return;
      try {
        socket!.send(JSON.stringify({ type: "start", text, language: "en", entry }));
      }
      catch {
        fail("Pronunciation stream unavailable");
      }
    };
    socket.onmessage = event => {
      if (settled || !current())
        return;
      let message: {
        type?: string;
        result?: PronunciationResult;
        message?: string;
      };
      try {
        message = JSON.parse(typeof event.data === "string" ? event.data : "");
        if (!message || typeof message !== "object")
          throw new Error();
      }
      catch {
        fail("Invalid pronunciation response");
        return;
      }
      if (message.type === "error") {
        fail(message.message || "语音评测未完成，请重试。");
        return;
      }
      if (message.type === "ready" && !ready) {
        ready = true;
        clearTimeout(readyTimer);
        startupBacklogMs = Math.min(12000, queuedBytes / 32);
        const frames = queue;
        queue = [];
        queuedBytes = 0;
        try {
          for (const frame of frames)
            sendFrame(frame);
        }
        catch (error) {
          settle({ error: error instanceof Error ? error : new Error("Pronunciation upload failed") });
          return;
        }
        end();
      }
      else if (message.type === "result") {
        const result = message.result;
        if (!ready || !ended || !result || !Array.isArray(result.words) || ![result.overall, result.accuracy, result.fluency, result.integrity, result.standard].every(Number.isFinite)) {
          fail("Invalid pronunciation result", false);
          return;
        }
        settle({ result });
      }
    };
    socket.onerror = () => fail("Pronunciation stream connection failed");
    socket.onclose = () => fail("Pronunciation stream disconnected");
  }
  catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      settle({ error });
    else
      fail("Pronunciation streaming unavailable");
  }
  return api;
}
