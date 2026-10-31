import type { VoiceEngine } from "../store/voice";

export const AUTO_CLOUD_VOICE = "catherine";
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
  signal?: AbortSignal,
): Promise<ResolvedVoiceMode> {
  if (engine === "iflytek") {
    return { kind: "iflytek", automaticFallback: false };
  }
  if (engine === "local") return { kind: "iflytek", automaticFallback: true };
  if (signal?.aborted) return { kind: "iflytek", automaticFallback: true };
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
      signal?.removeEventListener("abort", aborted);
      resolve(result);
    };
    const aborted = () => finish({ kind: "iflytek", automaticFallback: true });
    signal?.addEventListener("abort", aborted, { once: true });
    unsubscribe = source.subscribe(() => {
      if (source.listEnglishVoices().length > 0) {
        finish({ kind: "browser" });
      }
    });
    // A source may notify synchronously from subscribe().
    if (settled) { unsubscribe(); return; }
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
