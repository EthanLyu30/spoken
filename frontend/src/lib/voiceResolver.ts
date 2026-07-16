import type { VoiceEngine } from "../store/voice";

export const AUTO_CLOUD_VOICE = "x4_lindsey_formal";
export const AUTO_CLOUD_SPEED = 58;
export const AUTO_CLOUD_PITCH = 52;

export type ResolvedVoiceMode =
  | { kind: "browser" }
  | { kind: "iflytek"; automaticFallback: boolean };

export interface VoiceResolutionSource {
  listEnglishVoices: () => SpeechSynthesisVoice[];
  subscribe: (callback: () => void) => () => void;
  timeoutMs: number;
}

export async function resolveVoiceMode(
  engine: VoiceEngine,
  source: VoiceResolutionSource,
): Promise<ResolvedVoiceMode> {
  if (engine === "iflytek") {
    return { kind: "iflytek", automaticFallback: false };
  }
  if (source.listEnglishVoices().length > 0) {
    return { kind: "browser" };
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    let timer = 0;
    const finish = (result: ResolvedVoiceMode) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };
    unsubscribe = source.subscribe(() => {
      if (source.listEnglishVoices().length > 0) {
        finish({ kind: "browser" });
      }
    });
    timer = window.setTimeout(
      () =>
        finish({
          kind: "iflytek",
          automaticFallback: true,
        }),
      source.timeoutMs,
    );
  });
}

export function autoCloudOverrides(settings: {
  vcn: string | null;
  speed: number | null;
  pitch: number | null;
}) {
  return {
    vcn: settings.vcn ?? AUTO_CLOUD_VOICE,
    speed: settings.speed ?? AUTO_CLOUD_SPEED,
    pitch: settings.pitch ?? AUTO_CLOUD_PITCH,
  };
}
