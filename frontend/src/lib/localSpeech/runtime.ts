import { createLocalSpeechCoordinator } from "./coordinator";
import { readBrowserLocalSpeechCapability } from "./policy";

export const localSpeechCoordinator = createLocalSpeechCoordinator({
  capability: readBrowserLocalSpeechCapability(),
  loadMoonshine: async (report) => {
    const { loadMoonshineModel } = await import("./moonshine");
    await loadMoonshineModel(report);
  },
  loadKokoro: async (report) => {
    const { loadKokoroModel } = await import("./kokoro");
    await loadKokoroModel(report);
  },
});

export function isLocalSpeechModelReady(
  model: "moonshine" | "kokoro",
): boolean {
  return localSpeechCoordinator.getState(model) === "ready";
}
