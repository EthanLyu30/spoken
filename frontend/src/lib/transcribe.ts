import { postAsr } from "./api";
import { isLocalSpeechModelReady } from "./localSpeech/runtime";

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
      return (await backends.moonshine(pcm)).trim();
    } catch {
      // A worker can be evicted/crash independently. Recover this utterance via
      // the existing API instead of surfacing a broken recording to the user.
    }
  }
  return (await backends.cloud(pcm)).trim();
}

export async function transcribeSpeech(pcm: ArrayBuffer): Promise<string> {
  return transcribeSpeechWith(pcm, {
    isMoonshineReady: () => isLocalSpeechModelReady("moonshine"),
    moonshine: async (audio) => {
      const { transcribeWithMoonshine } = await import(
        "./localSpeech/moonshine"
      );
      return transcribeWithMoonshine(audio);
    },
    cloud: (audio) => postAsr(audio),
  });
}

/** Snapshot this at utterance start so an in-flight cloud turn is not mixed. */
export function isMoonshineTranscriptionReady(): boolean {
  return isLocalSpeechModelReady("moonshine");
}
