import { localSpeechCoordinator } from "./runtime";
import { scheduleLocalSpeechPreload } from "./policy";
import { useVoice } from "../../store/voice";

interface BootstrapDependencies {
  enabled?: () => boolean;
  schedule: (task: () => void) => () => void;
  hasEnglishBrowserVoice: () => Promise<boolean>;
  preload: (options: { includeKokoro: boolean }) => Promise<void>;
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
        let hasEnglishVoice = false;
        try {
          hasEnglishVoice = await dependencies.hasEnglishBrowserVoice();
        } catch {
          // Treat voice discovery failure the same as a missing browser voice.
        }
        await dependencies
          .preload({ includeKokoro: !hasEnglishVoice })
          .catch(() => undefined);
      })();
    });
  };
}

const startLocalModels = createLocalSpeechBootstrap({
  enabled: () => useVoice.getState().engine === "local",
  schedule: scheduleLocalSpeechPreload,
  hasEnglishBrowserVoice: async () => false,
  preload: (options) => localSpeechCoordinator.preload(options),
});

let subscribed = false;
export function bootstrapLocalSpeechModels(): void {
  if (!subscribed) {
    subscribed = true;
    useVoice.subscribe((state) => { if (state.engine === "local") startLocalModels(); });
  }
  startLocalModels();
}
