import { postAsr } from "./api";
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

/** One bounded cloud recovery chain, including two possible 1/4-speed uploads. */
export function asrTurnBudgetMs(pcm: ArrayBuffer): number {
  const frames = Math.ceil(pcm.byteLength / 1280);
  return Math.min(105_000, Math.max(20_000, 12_000 + frames * 20));
}

export async function transcribeSpeech(pcm: ArrayBuffer, signal?: AbortSignal, mode: "auto" | "cloud" = "auto"): Promise<string> {
  const generation = getAuthGeneration();
  const start = performance.now();
  const turnSignal = withTimeout(signal, asrTurnBudgetMs(pcm));
  if (turnSignal) bindInteraction(turnSignal, getInteraction(signal));
  const measurement: { engine: "local" | "xfyun" | "unknown" } = { engine: "unknown" };
  try {
  assertAuthGeneration(generation, turnSignal);
  const text = await transcribeSpeechWith(pcm, {
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
  assertAuthGeneration(generation, turnSignal);
  reportTiming("asr.transcribe", performance.now() - start, { engine: measurement.engine, interactionId: getInteraction(turnSignal), transport: measurement.engine === "local" ? "local" : "buffered", outcome: text ? "ok" : "error" });
  return text;
  } catch (error) {
    reportTiming("asr.transcribe", performance.now() - start, { engine: measurement.engine, interactionId: getInteraction(turnSignal), outcome: signal?.aborted || generation !== getAuthGeneration() ? "cancelled" : "error" });
    throw error;
  }
}

/** Snapshot this at utterance start so an in-flight cloud turn is not mixed. */
export function isMoonshineTranscriptionReady(): boolean {
  return useVoice.getState().engine === "local" && isLocalSpeechModelReady("moonshine");
}
