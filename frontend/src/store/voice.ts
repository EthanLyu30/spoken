import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VoiceEngine = "browser" | "iflytek" | "local";

/** Verified distinct English waveforms; unsupported IDs can silently use Xiaoyan. */
export const VOICE_OPTIONS: { id: string; label: string }[] = [
  { id: "catherine", label: "Catherine · 英文女声" },
  { id: "henry", label: "Henry · 英文男声" },
];

/**
 * User overrides for Pip's read-aloud voice.
 *
 * - `engine`: "browser" uses one OS/browser Web Speech utterance;
 *   "iflytek" generates one complete cloud audio file per reply.
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
    {
      name: "spoken-voice",
      version: 2,
      migrate: (persisted, version) => {
        const saved = persisted && typeof persisted === "object" ? persisted as Partial<VoiceState> : {};
        const engine = version < 1 ? saved.engine === "local" ? "local" : "browser"
          : saved.engine === "local" || saved.engine === "iflytek" ? saved.engine : "browser";
        const vcn = VOICE_OPTIONS.some(voice => voice.id === saved.vcn) ? saved.vcn : null;
        return { ...saved, engine, vcn } as VoiceState;
      },
    },
  ),
);
