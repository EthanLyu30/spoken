import { postAsr } from "./api";
import { isLocalSpeechModelReady } from "./localSpeech/runtime";
import { useVoice } from "../store/voice";
import { getInteraction, reportTiming } from "./telemetry";

interface TranscriptionBackends {
  isMoonshineReady: () => boolean;
  moonshine: (pcm: ArrayBuffer) => Promise<string>;
  cloud: (pcm: ArrayBuffer) => Promise<string>;
}

export async function transcribeSpeechWith(
  pcm: ArrayBuffer,
  backends: TranscriptionBackends,
): Promise<string> {
  if (backends.isMoonshineReady()) {
    try {
      const localText = (await backends.moonshine(pcm)).trim();
      if (localText) return localText;
    } catch {
      // A worker can be evicted/crash independently. Recover this utterance via
      // the existing API instead of surfacing a broken recording to the user.
    }
  }
  return (await backends.cloud(pcm)).trim();
}

export async function transcribeSpeech(pcm: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  const start = performance.now();
  const measurement: { engine: "local" | "xfyun" | "unknown" } = { engine: "unknown" };
  try {
  signal?.throwIfAborted();
  const text = await transcribeSpeechWith(pcm, {
    isMoonshineReady: isMoonshineTranscriptionReady,
    moonshine: async (audio) => {
      measurement.engine = "local";
      const { transcribeWithMoonshine } = await import(
        "./localSpeech/moonshine"
      );
      return transcribeWithMoonshine(audio);
    },
    cloud: (audio) => { measurement.engine = "xfyun"; return postAsr(audio, signal); },
  });
  signal?.throwIfAborted();
  reportTiming("asr.transcribe", performance.now() - start, { engine: measurement.engine, interactionId: getInteraction(signal), transport: measurement.engine === "local" ? "local" : "buffered", outcome: text ? "ok" : "error" });
  return text;
  } catch (error) {
    reportTiming("asr.transcribe", performance.now() - start, { engine: measurement.engine, interactionId: getInteraction(signal), outcome: signal?.aborted ? "cancelled" : "error" });
    throw error;
  }
}

/** Snapshot this at utterance start so an in-flight cloud turn is not mixed. */
export function isMoonshineTranscriptionReady(): boolean {
  return useVoice.getState().engine === "local" && isLocalSpeechModelReady("moonshine");
}
