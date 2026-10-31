import { env, pipeline } from "@huggingface/transformers";
import { pcm16ToFloat32 } from "./audio";
import { isAsrFastEnough } from "./performance";
import {
  errorMessage,
  type LocalWorkerRequest,
  type LocalWorkerResponse,
} from "./protocol";

const MODEL_ID = "onnx-community/moonshine-tiny-ONNX";

env.useBrowserCache = true;
env.allowLocalModels = false;

type Transcriber = (
  audio: Float32Array,
) => Promise<{ text?: string } | Array<{ text?: string }>>;

let modelPromise: Promise<Transcriber> | null = null;
let inferenceChain = Promise.resolve();

function post(message: LocalWorkerResponse): void {
  self.postMessage(message);
}

function loadModel(): Promise<Transcriber> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const loaded = await pipeline(
        "automatic-speech-recognition",
        MODEL_ID,
        {
          device: "wasm",
          dtype: {
            encoder_model: "fp32",
            decoder_model_merged: "q8",
          },
          progress_callback: (progress) =>
            post({ type: "progress", model: "moonshine", progress }),
        },
      );
      const transcriber = loaded as unknown as Transcriber;
      // Compile/warm the WASM graph during idle preload, not on the first turn.
      const probe = new Float32Array(16_000);
      await transcriber(probe);
      const started = performance.now();
      await transcriber(probe);
      const elapsedMs = performance.now() - started;
      if (
        !isAsrFastEnough({
          elapsedMs,
          sampleCount: probe.length,
          sampleRate: 16_000,
        })
      ) {
        throw new Error(
          `Moonshine is slower than the conversational latency budget (${Math.round(elapsedMs)} ms)`,
        );
      }
      return transcriber;
    })().catch(error => { modelPromise = null; throw error; });
  }
  return modelPromise;
}

async function transcribe(pcm: ArrayBuffer): Promise<string> {
  const model = await loadModel();
  const audio = pcm16ToFloat32(pcm);
  const run = inferenceChain.then(() => model(audio));
  inferenceChain = run.then(
    () => undefined,
    () => undefined,
  );
  const output = await run;
  const first = Array.isArray(output) ? output[0] : output;
  return first?.text?.trim() ?? "";
}

self.onmessage = (event: MessageEvent<LocalWorkerRequest>) => {
  const { id, type, payload } = event.data;
  void (async () => {
    try {
      let result: unknown;
      if (type === "load") {
        await loadModel();
      } else if (type === "transcribe") {
        const { pcm } = payload as { pcm: ArrayBuffer };
        result = await transcribe(pcm);
      } else {
        throw new Error(`Unknown Moonshine worker request: ${type}`);
      }
      post({ id, ok: true, result });
    } catch (error) {
      post({ id, ok: false, error: errorMessage(error) });
    }
  })();
};
