import { LocalModelWorkerClient } from "./workerClient";

const client = new LocalModelWorkerClient(
  () =>
    new Worker(new URL("./moonshine.worker.ts", import.meta.url), {
      type: "module",
      name: "moonshine-asr",
    }),
);

export async function loadMoonshineModel(report?: (progress: unknown) => void): Promise<void> {
  const unsubscribe = report ? client.subscribeProgress(report) : () => {};
  try { await client.request("load", undefined, [], 5 * 60_000); }
  finally { unsubscribe(); }
}

export async function transcribeWithMoonshine(
  pcm: ArrayBuffer,
): Promise<string> {
  // Keep the caller's buffer intact: conversation metadata reuses it for
  // pronunciation feedback after transcription.
  const transferable = pcm.slice(0);
  return client.request<string>(
    "transcribe",
    { pcm: transferable },
    [transferable],
    5_000,
  );
}
