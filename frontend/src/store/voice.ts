import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VoiceEngine = "browser" | "iflytek";

/**
 * User overrides for Pip's read-aloud voice.
 *
 * - `engine`: "browser" uses the OS/browser Web Speech voices (more natural,
 *   connected speech); "iflytek" uses the cloud cascade voices.
 * - `vcn` / `browserVoiceURI`: the chosen voice for each engine (null = auto).
 * - `speed` / `pitch`: 0-100 sliders (null = neutral / follow scenario), mapped
 *   per engine when speaking.
 */
interface VoiceState {
  engine: VoiceEngine;
  vcn: string | null;
  browserVoiceURI: string | null;
  speed: number | null;
  pitch: number | null;
  setEngine: (engine: VoiceEngine) => void;
  setVcn: (vcn: string | null) => void;
  setBrowserVoiceURI: (uri: string | null) => void;
  setSpeed: (speed: number | null) => void;
  setPitch: (pitch: number | null) => void;
  reset: () => void;
}

export const useVoice = create<VoiceState>()(
  persist(
    (set) => ({
      engine: "browser",
      vcn: null,
      browserVoiceURI: null,
      speed: null,
      pitch: null,
      setEngine: (engine) => set({ engine }),
      setVcn: (vcn) => set({ vcn }),
      setBrowserVoiceURI: (browserVoiceURI) => set({ browserVoiceURI }),
      setSpeed: (speed) => set({ speed }),
      setPitch: (pitch) => set({ pitch }),
      reset: () => set({ vcn: null, browserVoiceURI: null, speed: null, pitch: null }),
    }),
    { name: "spoken-voice" },
  ),
);

/** Selectable iFlytek English voices (only licensed/working ones). */
export const VOICE_OPTIONS: { id: string; label: string }[] = [
  { id: "x5_enus_flossie_flow", label: "Flossie · 活泼女声" },
  { id: "x3_enus_emma_assist", label: "Emma · 柔和女声" },
  { id: "x4_enus_luna_formal", label: "Luna · 知性女声" },
  { id: "x4_enus_laura_education", label: "Laura · 清晰女声" },
  { id: "x4_lindsey_formal", label: "Lindsey · 自然女声" },
  { id: "henry", label: "Henry · 沉稳男声" },
];
