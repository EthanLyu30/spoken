import { localSpeechCoordinator } from "./runtime";
import { scheduleLocalSpeechPreload } from "./policy";
import { useVoice } from "../../store/voice";
import type { LocalSpeechPreloadOptions } from "./coordinator";

interface BootstrapDependencies {
  enabled?: () => boolean;
  schedule: (task: () => void) => () => void;
  hasEnglishBrowserVoice: () => Promise<boolean>;
  priority?: LocalSpeechPreloadOptions["priority"];
  preload: (options: LocalSpeechPreloadOptions) => Promise<void>;
}

export function createLocalSpeechBootstrap(
  dependencies: BootstrapDependencies,
): () => void {
  let started = false;
  return () => {
    if (started || dependencies.enabled?.() === false) return;
    started = true;
    dependencies.schedule(() => {
      void (async () => {
        if (dependencies.enabled?.() === false) { started = false; return; }
        let hasEnglishVoice = false;
        try {
          hasEnglishVoice = await dependencies.hasEnglishBrowserVoice();
        } catch {
          // Treat voice discovery failure the same as a missing browser voice.
        }
        if (dependencies.enabled?.() === false) { started = false; return; }
        await dependencies.preload({ includeKokoro: !hasEnglishVoice,
          ...(dependencies.priority ? {priority:dependencies.priority} : {}),
        }).catch(() => undefined);
        // Completed or interrupted preparation can be resumed on the next
        // explicit local-mode selection. The coordinator deduplicates ready models.
        started = false;
      })();
    });
  };
}

const startLocalModels = createLocalSpeechBootstrap({
  enabled: () => useVoice.getState().engine === "local",
  schedule: scheduleLocalSpeechPreload,
  hasEnglishBrowserVoice: async () => false,
  priority: "kokoro",
  preload: (options) => localSpeechCoordinator.preload({...options,shouldContinue:()=>useVoice.getState().engine === "local"}),
});

let subscribed = false;
export function bootstrapLocalSpeechModels(): void {
  if (!subscribed) {
    subscribed = true;
    useVoice.subscribe((state, previous) => {
      if (state.engine === "local" && previous.engine !== "local") startLocalModels();
    });
  }
  startLocalModels();
}
