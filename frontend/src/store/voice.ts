import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { resilientStorage } from "../lib/resilientStorage";

export type VoiceEngine = "browser" | "local";

/** Browser read-aloud or explicitly selected local Kokoro; prosody uses 0–100 sliders. */
interface VoiceState {
  engine: VoiceEngine;
  browserVoiceURI: string | null;
  speed: number | null;
  pitch: number | null;
  setEngine: (engine: VoiceEngine) => void;
  setBrowserVoiceURI: (uri: string | null) => void;
  setSpeed: (speed: number | null) => void;
  setPitch: (pitch: number | null) => void;
  reset: () => void;
}

export const useVoice = create<VoiceState>()(
  persist(
    (set) => ({
      engine: "browser",
      browserVoiceURI: null,
      speed: null,
      pitch: null,
      setEngine: (engine) => set({ engine }),
      setBrowserVoiceURI: (browserVoiceURI) => set({ browserVoiceURI }),
      setSpeed: (speed) => set({ speed }),
      setPitch: (pitch) => set({ pitch }),
      reset: () => set({ browserVoiceURI: null, speed: null, pitch: null }),
    }),
    {
      name: "spoken-voice",
      storage: createJSONStorage(() => resilientStorage),
      version: 3,
      migrate: (persisted) => {
        const saved = persisted && typeof persisted === "object" ? persisted as Partial<VoiceState> : {};
        return {
          engine: saved.engine === "local" ? "local" : "browser",
          browserVoiceURI: saved.browserVoiceURI ?? null,
          speed: saved.speed ?? null,
          pitch: saved.pitch ?? null,
        } as VoiceState;
      },
    },
  ),
);
