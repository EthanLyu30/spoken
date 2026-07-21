import { createLocalSpeechCoordinator } from "./coordinator";
import { readBrowserLocalSpeechCapability } from "./policy";

export const localSpeechCoordinator = createLocalSpeechCoordinator({
  capability: readBrowserLocalSpeechCapability(),
  loadMoonshine: async () => {
    const { loadMoonshineModel } = await import("./moonshine");
    await loadMoonshineModel();
  },
  loadKokoro: async () => {
    const { loadKokoroModel } = await import("./kokoro");
    await loadKokoroModel();
  },
});

export function isLocalSpeechModelReady(
  model: "moonshine" | "kokoro",
): boolean {
  return localSpeechCoordinator.getState(model) === "ready";
}
