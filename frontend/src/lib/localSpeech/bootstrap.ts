import { localSpeechCoordinator } from "./runtime";
import { scheduleLocalSpeechPreload } from "./policy";

interface BootstrapDependencies {
  schedule: (task: () => void) => () => void;
  hasEnglishBrowserVoice: () => Promise<boolean>;
  preload: (options: { includeKokoro: boolean }) => Promise<void>;
}

export function createLocalSpeechBootstrap(
  dependencies: BootstrapDependencies,
): () => void {
  let started = false;
  return () => {
    if (started) return;
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

async function discoverEnglishBrowserVoice(): Promise<boolean> {
  if (!("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  const hasEnglish = () =>
    synth
      .getVoices()
      .some((voice) => voice.lang?.toLowerCase().startsWith("en"));
  if (hasEnglish()) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(hasEnglish());
    };
    const onVoicesChanged = () => {
      if (hasEnglish()) finish();
    };
    const timer = window.setTimeout(finish, 750);
    synth.addEventListener("voiceschanged", onVoicesChanged);
  });
}

export const bootstrapLocalSpeechModels = createLocalSpeechBootstrap({
  schedule: scheduleLocalSpeechPreload,
  hasEnglishBrowserVoice: discoverEnglishBrowserVoice,
  preload: (options) => localSpeechCoordinator.preload(options),
});
