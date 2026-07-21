export type LocalSpeechBlockReason =
  | "save-data"
  | "low-memory"
  | "low-cpu"
  | "no-worker"
  | "no-cache";

export type LocalSpeechCapability =
  | { eligible: true }
  | { eligible: false; reason: LocalSpeechBlockReason };

export interface LocalSpeechSignals {
  worker: boolean;
  cacheStorage: boolean;
  saveData?: boolean;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/**
 * Background model downloads are intentionally conservative. A user who has
 * enabled data saver, or a device reporting at most 2 GB RAM / 2 logical CPU
 * cores, keeps the cloud path instead of paying a large download/memory cost.
 */
export function assessLocalSpeechCapability(
  signals: LocalSpeechSignals,
): LocalSpeechCapability {
  if (!signals.worker) return { eligible: false, reason: "no-worker" };
  if (!signals.cacheStorage) return { eligible: false, reason: "no-cache" };
  if (signals.saveData) return { eligible: false, reason: "save-data" };
  if (signals.deviceMemory !== undefined && signals.deviceMemory <= 2) {
    return { eligible: false, reason: "low-memory" };
  }
  if (
    signals.hardwareConcurrency !== undefined &&
    signals.hardwareConcurrency <= 2
  ) {
    return { eligible: false, reason: "low-cpu" };
  }
  return { eligible: true };
}

type NavigatorWithHints = Navigator & {
  connection?: { saveData?: boolean };
  deviceMemory?: number;
};

export function readBrowserLocalSpeechCapability(): LocalSpeechCapability {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { eligible: false, reason: "no-worker" };
  }
  const hints = navigator as NavigatorWithHints;
  return assessLocalSpeechCapability({
    worker: "Worker" in window,
    cacheStorage: "caches" in window,
    saveData: hints.connection?.saveData,
    deviceMemory: hints.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
  });
}

export interface IdleScheduler {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
}

function defaultScheduler(): IdleScheduler {
  const host = window as Window &
    typeof globalThis & {
      requestIdleCallback?: IdleScheduler["requestIdleCallback"];
      cancelIdleCallback?: IdleScheduler["cancelIdleCallback"];
    };
  return {
    requestIdleCallback: host.requestIdleCallback?.bind(host),
    cancelIdleCallback: host.cancelIdleCallback?.bind(host),
    setTimeout: host.setTimeout.bind(host),
    clearTimeout: host.clearTimeout.bind(host),
  };
}

/** Schedule after first paint, while guaranteeing eventual execution. */
export function scheduleLocalSpeechPreload(
  task: () => void,
  scheduler: IdleScheduler = defaultScheduler(),
): () => void {
  if (scheduler.requestIdleCallback) {
    const handle = scheduler.requestIdleCallback(() => task(), {
      timeout: 4_000,
    });
    return () => scheduler.cancelIdleCallback?.(handle);
  }

  const handle = scheduler.setTimeout(task, 1_500);
  return () => scheduler.clearTimeout(handle);
}
