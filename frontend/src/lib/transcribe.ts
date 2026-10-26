import { postAsr } from "./api";
import { isLocalSpeechModelReady } from "./localSpeech/runtime";
import { useVoice } from "../store/voice";

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
  signal?.throwIfAborted();
  const text = await transcribeSpeechWith(pcm, {
    isMoonshineReady: isMoonshineTranscriptionReady,
    moonshine: async (audio) => {
      const { transcribeWithMoonshine } = await import(
        "./localSpeech/moonshine"
      );
      return transcribeWithMoonshine(audio);
    },
    cloud: (audio) => postAsr(audio, signal),
  });
  signal?.throwIfAborted();
  return text;
}

/** Snapshot this at utterance start so an in-flight cloud turn is not mixed. */
export function isMoonshineTranscriptionReady(): boolean {
  return useVoice.getState().engine === "local" && isLocalSpeechModelReady("moonshine");
}
