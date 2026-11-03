import { postAsr } from "./api";
import { openAsrStream, type AsrStream } from "./asrStream";
import { isLocalSpeechModelReady, localSpeechCoordinator } from "./localSpeech/runtime";
import { useVoice } from "../store/voice";
import { getInteraction, bindInteraction, reportTiming } from "./telemetry";
import { withTimeout } from "./requestTimeout";
import { assertAuthGeneration, getAuthGeneration } from "./authToken";

interface TranscriptionBackends {
  isMoonshineReady: () => boolean;
  moonshine: (pcm: ArrayBuffer) => Promise<string>;
  cloud: (pcm: ArrayBuffer) => Promise<string>;
}

export async function transcribeSpeechWith(
  pcm: ArrayBuffer,
  backends: TranscriptionBackends,
  signal?: AbortSignal,
): Promise<string> {
  const generation = getAuthGeneration();
  assertAuthGeneration(generation, signal);
  if (backends.isMoonshineReady()) {
    try {
      const localText = (await backends.moonshine(pcm)).trim();
      assertAuthGeneration(generation, signal);
      if (localText) return localText;
    } catch (error) {
      assertAuthGeneration(generation, signal);
      signal?.throwIfAborted();
      if ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError") throw error;
      // A worker can be evicted/crash independently. Recover this utterance via
      // the existing API instead of surfacing a broken recording to the user.
    }
  }
  assertAuthGeneration(generation, signal);
  const text = (await backends.cloud(pcm)).trim();
  assertAuthGeneration(generation, signal);
  return text;
}

export interface LiveTranscription {
  /** Feed captured PCM while the microphone is still recording. */
  send: (pcm: ArrayBuffer) => void;
  /** Finish the utterance and return its transcript, buffered only on failure. */
  finish: (pcm: ArrayBuffer, signal?: AbortSignal) => Promise<string>;
  close: () => void;
}

/**
 * Start one provider stream at recording start instead of replaying the clip
 * after Stop. Audio received before the socket opens is queued and flushed in
 * order; if the stream cannot open, `finish` recovers through buffered ASR.
 */
export function createLiveTranscription(signal?: AbortSignal): LiveTranscription {
  let stream: AsrStream | null = null;
  let closed = false;
  let latest = "";
  const queue: ArrayBuffer[] = [];
  const control = new AbortController();
  const interactionId = getInteraction(signal);
  if (interactionId) bindInteraction(control.signal, interactionId);
  const abort = () => control.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const opened = openAsrStream(
    { onPartial: (text) => { latest = text; } },
    "en_us",
    control.signal,
  ).then((openedStream) => {
    stream = openedStream;
    for (const pcm of queue) openedStream.send(pcm);
    queue.length = 0;
    return openedStream;
  }).catch(() => null);
  return {
    send(pcm) {
      if (closed) return;
      if (stream) stream.send(pcm);
      else queue.push(pcm);
    },
    async finish(pcm, finishSignal) {
      closed = true;
      const cancel = () => control.abort();
      finishSignal?.addEventListener("abort", cancel, { once: true });
      try {
        const openedStream = stream ?? await opened;
        if (!openedStream) return (await postAsr(pcm, finishSignal)).trim();
        try {
          const text = (await openedStream.finishUtterance()).trim();
          return text || latest.trim();
        } catch (error) {
          if (finishSignal?.aborted) throw error;
          // A deploy can close the relay mid-utterance. Prefer the complete
          // recording over a truncated partial; keep the partial only if the
          // recovery request also fails.
          const partial = latest.trim();
          try {
            const recovered = (await postAsr(pcm, finishSignal)).trim();
            if (recovered) return recovered;
          } catch (recoveryError) {
            if (finishSignal?.aborted || control.signal.aborted) throw recoveryError;
          }
          if (partial) return partial;
          throw error;
        } finally {
          openedStream.close();
        }
      } finally {
        finishSignal?.removeEventListener("abort", cancel);
        signal?.removeEventListener("abort", abort);
        if (finishSignal?.aborted) control.abort();
      }
    },
    close() {
      closed = true;
      control.abort();
      stream?.close();
      queue.length = 0;
      signal?.removeEventListener("abort", abort);
    },
  };
}

/** One bounded cloud recovery chain, including two possible 1/4-speed uploads. */
export function asrTurnBudgetMs(pcm: ArrayBuffer): number {
  const frames = Math.ceil(pcm.byteLength / 1280);
  return Math.min(105_000, Math.max(20_000, 12_000 + frames * 20));
}

export async function transcribeSpeech(
  pcm: ArrayBuffer,
  signal?: AbortSignal,
  mode: "auto" | "cloud" = "auto",
  live?: LiveTranscription,
): Promise<string> {
  const generation = getAuthGeneration();
  const start = performance.now();
  const turnSignal = withTimeout(signal, asrTurnBudgetMs(pcm));
  if (turnSignal) bindInteraction(turnSignal, getInteraction(signal));
  const measurement: { engine: "local" | "xfyun" | "unknown" } = { engine: "unknown" };
  // A live stream wins unless the learner explicitly prepared the local model.
  // The stream already contains the whole utterance, so there is no replay.
  const useLive = !!live && !(mode !== "cloud" && isMoonshineTranscriptionReady());
  if (live && !useLive) live.close();
  try {
    assertAuthGeneration(generation, turnSignal);
    let text: string;
    if (useLive && live) {
      measurement.engine = "xfyun";
      text = (await live.finish(pcm, turnSignal)).trim();
    } else {
      text = await transcribeSpeechWith(pcm, {
        isMoonshineReady: () => mode !== "cloud" && isMoonshineTranscriptionReady(),
        moonshine: async (audio) => {
          measurement.engine = "local";
          const { transcribeWithMoonshine } = await import(
            "./localSpeech/moonshine"
          );
          assertAuthGeneration(generation, turnSignal);
          try { return await transcribeWithMoonshine(audio); }
          catch (error) { assertAuthGeneration(generation, turnSignal); localSpeechCoordinator.markError("moonshine",error); throw error; }
        },
        cloud: (audio) => { measurement.engine = "xfyun"; return postAsr(audio, turnSignal); },
      }, turnSignal);
    }
    assertAuthGeneration(generation, turnSignal);
    reportTiming("asr.transcribe", performance.now() - start, {
      engine: measurement.engine,
      interactionId: getInteraction(turnSignal),
      transport: useLive ? "direct" : measurement.engine === "local" ? "local" : "buffered",
      outcome: text ? "ok" : "error",
    });
    return text;
  } catch (error) {
    if (live && !useLive) live.close();
    reportTiming("asr.transcribe", performance.now() - start, { engine: measurement.engine, interactionId: getInteraction(turnSignal), outcome: signal?.aborted || generation !== getAuthGeneration() ? "cancelled" : "error" });
    throw error;
  }
}

/** Snapshot this at utterance start so an in-flight cloud turn is not mixed. */
export function isMoonshineTranscriptionReady(): boolean {
  return useVoice.getState().engine === "local" && isLocalSpeechModelReady("moonshine");
}
