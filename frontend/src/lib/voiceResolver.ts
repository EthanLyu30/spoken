import type { VoiceEngine } from "../store/voice";

export type ResolvedVoiceMode = { kind: "browser" } | { kind: "unavailable" };

export interface VoiceResolutionSource {
  listEnglishVoices: () => SpeechSynthesisVoice[];
  subscribe: (callback: () => void) => () => void;
  timeoutMs: number;
}

export async function resolveVoiceMode(
  _engine: VoiceEngine,
  source: VoiceResolutionSource,
  signal?: AbortSignal,
): Promise<ResolvedVoiceMode> {
  if (signal?.aborted) return { kind: "unavailable" };
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
    const aborted = () => finish({ kind: "unavailable" });
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
          kind: "unavailable",
        }),
      source.timeoutMs,
    );
  });
}
