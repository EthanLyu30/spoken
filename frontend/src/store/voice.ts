import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * User overrides for Pip's voice. `null` means "follow the scenario's tuned
 * voice"; a value overrides it everywhere. Persisted across sessions.
 */
interface VoiceState {
  vcn: string | null;
  speed: number | null;
  pitch: number | null;
  setVcn: (vcn: string | null) => void;
  setSpeed: (speed: number | null) => void;
  setPitch: (pitch: number | null) => void;
  reset: () => void;
}

export const useVoice = create<VoiceState>()(
  persist(
    (set) => ({
      vcn: null,
      speed: null,
      pitch: null,
      setVcn: (vcn) => set({ vcn }),
      setSpeed: (speed) => set({ speed }),
      setPitch: (pitch) => set({ pitch }),
      reset: () => set({ vcn: null, speed: null, pitch: null }),
    }),
    { name: "spoken-voice" },
  ),
);

/** Selectable English voices (only iFlytek voices that are licensed/working). */
export const VOICE_OPTIONS: { id: string; label: string }[] = [
  { id: "x5_enus_flossie_flow", label: "Flossie · 活泼女声" },
  { id: "x3_enus_emma_assist", label: "Emma · 柔和女声" },
  { id: "x4_enus_luna_formal", label: "Luna · 知性女声" },
  { id: "x4_enus_laura_education", label: "Laura · 清晰女声" },
  { id: "x4_lindsey_formal", label: "Lindsey · 自然女声" },
  { id: "henry", label: "Henry · 沉稳男声" },
];
