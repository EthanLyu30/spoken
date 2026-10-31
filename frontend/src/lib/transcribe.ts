import { postAsr } from "./api";
import { isLocalSpeechModelReady, localSpeechCoordinator } from "./localSpeech/runtime";
import { useVoice } from "../store/voice";
import { getInteraction, reportTiming } from "./telemetry";
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

export async function transcribeSpeech(pcm: ArrayBuffer, signal?: AbortSignal, mode: "auto" | "cloud" = "auto"): Promise<string> {
  const generation = getAuthGeneration();
  const start = performance.now();
  const measurement: { engine: "local" | "xfyun" | "unknown" } = { engine: "unknown" };
  try {
  assertAuthGeneration(generation, signal);
  const text = await transcribeSpeechWith(pcm, {
    isMoonshineReady: () => mode !== "cloud" && isMoonshineTranscriptionReady(),
    moonshine: async (audio) => {
      measurement.engine = "local";
      const { transcribeWithMoonshine } = await import(
        "./localSpeech/moonshine"
      );
      assertAuthGeneration(generation, signal);
      try { return await transcribeWithMoonshine(audio); }
      catch (error) { assertAuthGeneration(generation, signal); localSpeechCoordinator.markError("moonshine",error); throw error; }
    },
    cloud: (audio) => { measurement.engine = "xfyun"; return postAsr(audio, signal); },
  }, signal);
  assertAuthGeneration(generation, signal);
  reportTiming("asr.transcribe", performance.now() - start, { engine: measurement.engine, interactionId: getInteraction(signal), transport: measurement.engine === "local" ? "local" : "buffered", outcome: text ? "ok" : "error" });
  return text;
  } catch (error) {
    reportTiming("asr.transcribe", performance.now() - start, { engine: measurement.engine, interactionId: getInteraction(signal), outcome: signal?.aborted || generation !== getAuthGeneration() ? "cancelled" : "error" });
    throw error;
  }
}

/** Snapshot this at utterance start so an in-flight cloud turn is not mixed. */
export function isMoonshineTranscriptionReady(): boolean {
  return useVoice.getState().engine === "local" && isLocalSpeechModelReady("moonshine");
}
