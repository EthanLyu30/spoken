import { create } from "zustand";
import type { VoiceEngine } from "./voice";

export interface SpeechPlayback {
  id: number;
  requestedEngine: VoiceEngine;
  effectiveEngine: "browser" | "xfyun" | "local" | null;
  voice: string | null;
  phase: "waiting" | "preparing" | "speaking" | "completed" | "cancelled" | "error";
  fallbackReason: "browser-unavailable" | "local-unavailable" | null;
}

// Playback is transient device state, never a persisted voice preference.
export const useSpeechPlayback = create<{ playback: SpeechPlayback | null }>(() => ({ playback: null }));
let sequence = 0;

export function beginSpeechPlayback(requestedEngine: VoiceEngine) {
  let status: SpeechPlayback = { id: ++sequence, requestedEngine, effectiveEngine: null,
    voice: null, phase: "waiting", fallbackReason: null };
  useSpeechPlayback.setState({ playback: status });
  return {
    get status() { return status; },
    update(patch: Partial<Omit<SpeechPlayback, "id" | "requestedEngine">>) {
      status = { ...status, ...patch };
      if (useSpeechPlayback.getState().playback?.id === status.id) {
        useSpeechPlayback.setState({ playback: status });
      }
    },
  };
}
