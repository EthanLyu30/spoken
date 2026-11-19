import type { VoiceEngine } from "../store/voice";

export type ResolvedVoiceMode = { kind: "browser" } | { kind: "unavailable" };
export type VoiceDiscoveryTrigger = "initial" | "event" | "poll" | "deadline" | "aborted";

export interface VoiceResolutionSource {
  listEnglishVoices: () => SpeechSynthesisVoice[];
  subscribe: (callback: () => void) => () => void;
  timeoutMs: number;
  onSettled?: (trigger: VoiceDiscoveryTrigger) => void;
}

export async function resolveVoiceMode(
  _engine: VoiceEngine,
  source: VoiceResolutionSource,
  signal?: AbortSignal,
): Promise<ResolvedVoiceMode> {
  if (signal?.aborted) {
    source.onSettled?.("aborted");
    return { kind: "unavailable" };
  }
  if (source.listEnglishVoices().length > 0) {
    source.onSettled?.("initial");
    return { kind: "browser" };
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    let timer = 0;
    let poll = 0;
    const finish = (result: ResolvedVoiceMode, trigger: VoiceDiscoveryTrigger) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      unsubscribe();
      signal?.removeEventListener("abort", aborted);
      source.onSettled?.(trigger);
      resolve(result);
    };
    const aborted = () => finish({ kind: "unavailable" }, "aborted");
    signal?.addEventListener("abort", aborted, { once: true });
    const check = (trigger: "event" | "poll") => {
      if (source.listEnglishVoices().length > 0) {
        finish({ kind: "browser" }, trigger);
      }
    };
    unsubscribe = source.subscribe(() => check("event"));
    // A source may notify synchronously from subscribe().
    if (settled) { unsubscribe(); return; }
    // Some engines populate getVoices() without dispatching voiceschanged.
    poll = window.setInterval(() => check("poll"), 100);
    timer = window.setTimeout(() => {
      check("poll");
      finish({ kind: "unavailable" }, "deadline");
    }, source.timeoutMs);
  });
}
