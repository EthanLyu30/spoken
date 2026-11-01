/** Best-effort handshake only. Never wait for it once final text is available. */
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface CloudSpeechPreparation {
  take(): string | undefined;
  dispose(): void;
}

export function prepareCloudSpeech(signal?: AbortSignal): CloudSpeechPreparation {
  const controller = new AbortController();
  let ticket: string | undefined;
  let disposed = false;
  let timer = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ticket = undefined;
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", dispose);
    controller.abort();
  };
  const take = () => {
    const ready = !disposed && !signal?.aborted ? ticket : undefined;
    dispose();
    return ready;
  };
  if (signal?.aborted) {
    dispose();
    return {take, dispose};
  }
  signal?.addEventListener("abort", dispose, {once: true});
  timer = window.setTimeout(dispose, 1500);
  // A simple POST avoids an extra cross-origin JSON preflight. No text,
  // credentials or provider URL are involved in preparing a connection.
  void (async () => {
    const response = await fetch(`${BASE}/api/tts/prepare`, {
      method: "POST", cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) return;
    const data = await response.json() as {ticket?: unknown};
    if (!disposed && typeof data.ticket === "string" && /^[a-f0-9]{32}$/.test(data.ticket)) ticket = data.ticket;
  })().catch(() => undefined).finally(() => {
    window.clearTimeout(timer);
    if (!ticket) dispose();
  });
  return {take, dispose};
}
