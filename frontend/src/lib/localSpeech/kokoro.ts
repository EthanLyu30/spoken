import { LocalModelWorkerClient } from "./workerClient";

const client = new LocalModelWorkerClient(
  () =>
    new Worker(new URL("./kokoro.worker.ts", import.meta.url), {
      type: "module",
      name: "kokoro-tts",
    }),
);

export async function loadKokoroModel(report?: (progress: unknown) => void): Promise<void> {
  const unsubscribe = report ? client.subscribeProgress(report) : () => {};
  try { await client.request("load", undefined, [], 8 * 60_000); }
  finally { unsubscribe(); }
}

export async function synthesizeWithKokoro(
  text: string,
  speed = 1,
): Promise<{ audio: Float32Array; sampleRate: number }> {
  const result = await client.request<{
    audio: ArrayBuffer;
    sampleRate: number;
  }>("synthesize", { text, speed }, [], 2_000);
  return {
    audio: new Float32Array(result.audio),
    sampleRate: result.sampleRate,
  };
}
