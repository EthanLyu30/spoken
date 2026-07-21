import type { LocalSpeechCapability } from "./policy";

export type LocalSpeechModel = "moonshine" | "kokoro";
export type LocalSpeechModelState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

interface CoordinatorOptions {
  capability: LocalSpeechCapability;
  loadMoonshine: () => Promise<void>;
  loadKokoro: () => Promise<void>;
}

export interface LocalSpeechCoordinator {
  preload: (options: { includeKokoro: boolean }) => Promise<void>;
  getState: (model: LocalSpeechModel) => LocalSpeechModelState;
}

export function createLocalSpeechCoordinator({
  capability,
  loadMoonshine,
  loadKokoro,
}: CoordinatorOptions): LocalSpeechCoordinator {
  const state: Record<LocalSpeechModel, LocalSpeechModelState> = {
    moonshine: "idle",
    kokoro: "idle",
  };
  const inFlight: Partial<Record<LocalSpeechModel, Promise<void>>> = {};
  let serial = Promise.resolve();

  const loaderFor = (model: LocalSpeechModel) =>
    model === "moonshine" ? loadMoonshine : loadKokoro;

  const ensure = (model: LocalSpeechModel): Promise<void> => {
    if (state[model] === "ready" || state[model] === "unavailable") {
      return Promise.resolve();
    }
    const existing = inFlight[model];
    if (existing) return existing;

    state[model] = "loading";
    const run = serial.then(loaderFor(model));
    // A failed model must not poison the queue; the other model can still load.
    serial = run.catch(() => undefined);
    const observed = run.then(
      () => {
        state[model] = "ready";
      },
      () => {
        state[model] = "error";
      },
    );
    inFlight[model] = observed;
    return observed;
  };

  return {
    preload: async ({ includeKokoro }) => {
      if (!capability.eligible) {
        state.moonshine = "unavailable";
        if (includeKokoro) state.kokoro = "unavailable";
        return;
      }
      await ensure("moonshine");
      if (includeKokoro) await ensure("kokoro");
    },
    getState: (model) => state[model],
  };
}
