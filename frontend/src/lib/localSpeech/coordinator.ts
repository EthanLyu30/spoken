import type { LocalSpeechCapability } from "./policy";
import { errorMessage } from "./protocol";

export type LocalSpeechModel = "moonshine" | "kokoro";
export type LocalSpeechModelState =
  | "idle"
  | "queued"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

interface CoordinatorOptions {
  capability: LocalSpeechCapability;
  loadMoonshine: (report: (progress: unknown) => void) => Promise<void>;
  loadKokoro: (report: (progress: unknown) => void) => Promise<void>;
}

export interface LocalSpeechModelSnapshot {
  state: LocalSpeechModelState;
  downloadedBytes: number;
  error: string | null;
}
export type LocalSpeechSnapshot = Readonly<Record<LocalSpeechModel, Readonly<LocalSpeechModelSnapshot>>>;
export interface LocalSpeechPreloadOptions {
  includeKokoro: boolean;
  priority?: LocalSpeechModel;
  shouldContinue?: () => boolean;
}

export interface LocalSpeechCoordinator {
  preload: (options: LocalSpeechPreloadOptions) => Promise<void>;
  getState: (model: LocalSpeechModel) => LocalSpeechModelState;
  getSnapshot: () => LocalSpeechSnapshot;
  subscribe: (listener: () => void) => () => void;
  markError: (model: LocalSpeechModel, error: unknown) => void;
}

export function createLocalSpeechCoordinator({
  capability,
  loadMoonshine,
  loadKokoro,
}: CoordinatorOptions): LocalSpeechCoordinator {
  let snapshot: LocalSpeechSnapshot = {
    moonshine: { state:"idle", downloadedBytes:0, error:null },
    kokoro: { state:"idle", downloadedBytes:0, error:null },
  };
  const listeners = new Set<() => void>();
  const inFlight: Partial<Record<LocalSpeechModel, Promise<void>>> = {};
  let serial = Promise.resolve();

  const update = (model:LocalSpeechModel, patch:Partial<LocalSpeechModelSnapshot>) => {
    snapshot = { ...snapshot, [model]:{...snapshot[model], ...patch} };
    listeners.forEach(listener => listener());
  };
  const markError = (model:LocalSpeechModel, error:unknown) => update(model,{state:"error",error:errorMessage(error)});

  const ensure = (model: LocalSpeechModel, shouldContinue?:()=>boolean): Promise<void> => {
    if (snapshot[model].state === "ready" || snapshot[model].state === "unavailable") {
      return Promise.resolve();
    }
    const existing = inFlight[model];
    if (existing) return existing;

    update(model,{state:"queued",downloadedBytes:0,error:null});
    const files = new Map<string, number>();
    const report = (event:unknown) => {
      if (!event || typeof event !== "object") return;
      const progress = event as {file?:unknown;loaded?:unknown;status?:unknown};
      if (progress.status !== "progress" || typeof progress.file !== "string" || typeof progress.loaded !== "number" || !Number.isFinite(progress.loaded) || progress.loaded < 0) return;
      files.set(progress.file,Math.max(files.get(progress.file) ?? 0,progress.loaded));
      update(model,{downloadedBytes:[...files.values()].reduce((a,b)=>a+b,0)});
    };
    const run = serial.then(async () => {
      if (shouldContinue?.() === false) { update(model,{state:"idle"}); return; }
      update(model,{state:"loading"});
      await (model === "moonshine" ? loadMoonshine : loadKokoro)(report);
      update(model,{state:"ready",error:null});
    });
    // A failed model must not poison the queue; the other model can still load.
    serial = run.catch(() => undefined);
    const observed = run.catch(error=>markError(model,error)).finally(()=>{delete inFlight[model];});
    inFlight[model] = observed;
    return observed;
  };

  return {
    preload: async ({ includeKokoro, priority, shouldContinue }) => {
      const models:LocalSpeechModel[] = includeKokoro
        ? priority === "kokoro" ? ["kokoro","moonshine"] : ["moonshine","kokoro"]
        : ["moonshine"];
      for (const model of models) {
        if (shouldContinue?.() === false) return;
        if (!capability.eligible) update(model,{state:"unavailable",error:capability.reason});
        else await ensure(model,shouldContinue);
      }
    },
    getState: (model) => snapshot[model].state,
    getSnapshot: ()=>snapshot,
    subscribe: listener=>{listeners.add(listener); return ()=>{listeners.delete(listener);};},
    markError,
  };
}
