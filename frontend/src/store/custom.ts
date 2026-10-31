import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { resilientStorage } from "../lib/resilientStorage";
import { type CustomScene } from "../lib/api";

/**
 * The active user-defined scene. Persisted so a refresh on the conversation or
 * report page keeps the scene (it isn't in the static catalogue).
 */
interface CustomState {
  scene: CustomScene | null;
  setScene: (scene: CustomScene) => void;
  clear: () => void;
}

export const useCustomScene = create<CustomState>()(
  persist(
    (set) => ({
      scene: null,
      setScene: (scene) => set({ scene }),
      clear: () => set({ scene: null }),
    }),
    { name: "spoken-custom-scene", storage: createJSONStorage(() => resilientStorage) },
  ),
);
