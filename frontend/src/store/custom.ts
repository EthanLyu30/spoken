import { create } from "zustand";
import { getToken, subscribeAuthGeneration, tokenCacheIdentity } from "../lib/authToken";
import { getClientId } from "../lib/clientId";
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

function storageKey(): string | null {
  const token = getToken();
  if (!token) return "spoken-custom-scene:guest:" + getClientId();
  const identity = tokenCacheIdentity(token);
  return identity ? "spoken-custom-scene:account:" + JSON.stringify([identity.subject, identity.version]) : null;
}

function readScene(): CustomScene | null {
  const key = storageKey();
  try {
    const raw = key ? resilientStorage.getItem(key) : null;
    return raw ? JSON.parse(raw) as CustomScene : null;
  } catch {
    return null;
  }
}

export const useCustomScene = create<CustomState>((set) => ({
  scene: readScene(),
  setScene(scene) {
    const key = storageKey();
    if (key) resilientStorage.setItem(key, JSON.stringify(scene));
    set({ scene });
  },
  clear() {
    const key = storageKey();
    if (key) resilientStorage.removeItem(key);
    set({ scene: null });
  },
}));

subscribeAuthGeneration(() => {
  useCustomScene.setState({ scene: readScene() });
});
