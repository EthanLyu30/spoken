import { env as transformersEnv } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import { isTtsFastEnough } from "./performance";
import {
  errorMessage,
  type LocalWorkerRequest,
  type LocalWorkerResponse,
} from "./protocol";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";

transformersEnv.useBrowserCache = true;
transformersEnv.allowLocalModels = false;

let modelPromise: Promise<KokoroTTS> | null = null;
let inferenceChain = Promise.resolve();

type KokoroRuntime =
  | { device: "wasm"; dtype: "q8" }
  | { device: "webgpu"; dtype: "q4f16" };

type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: () => Promise<{
      features: { has: (feature: string) => boolean };
    } | null>;
  };
};

class SlowLocalTtsError extends Error {}

function post(message: LocalWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

async function preferredRuntime(): Promise<KokoroRuntime> {
  const gpu = (navigator as NavigatorWithGpu).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter?.features.has("shader-f16")) {
        return { device: "webgpu", dtype: "q4f16" };
      }
    } catch {
      // WASM below is the portable path.
    }
  }
  return { device: "wasm", dtype: "q8" };
}

async function loadAndBenchmark(runtime: KokoroRuntime): Promise<KokoroTTS> {
  const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    ...runtime,
    progress_callback: (progress) =>
      post({ type: "progress", model: "kokoro", progress }),
  });
  // First run downloads the voice and compiles kernels. The second run measures
  // steady-state latency, which decides whether local TTS is suitable here.
  await tts.generate("Ready.", { voice: VOICE });
  const started = performance.now();
  const probe = await tts.generate("Hello there.", { voice: VOICE });
  const elapsedMs = performance.now() - started;
  if (
    !isTtsFastEnough({
      elapsedMs,
      sampleCount: probe.audio.length,
      sampleRate: probe.sampling_rate,
    })
  ) {
    throw new SlowLocalTtsError(
      `Kokoro is slower than the conversational latency budget (${Math.round(elapsedMs)} ms)`,
    );
  }
  return tts;
}

function loadModel(): Promise<KokoroTTS> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const runtime = await preferredRuntime();
      try {
        return await loadAndBenchmark(runtime);
      } catch (error) {
        if (runtime.device === "webgpu" && !(error instanceof SlowLocalTtsError)) {
          return loadAndBenchmark({ device: "wasm", dtype: "q8" });
        }
        throw error;
      }
    })().catch(error => { modelPromise = null; throw error; });
  }
  return modelPromise;
}

async function synthesize(
  text: string,
  speed: number,
): Promise<{ audio: ArrayBuffer; sampleRate: number }> {
  const model = await loadModel();
  const run = inferenceChain.then(() =>
    model.generate(text, { voice: VOICE, speed }),
  );
  inferenceChain = run.then(
    () => undefined,
    () => undefined,
  );
  const output = await run;
  const audio = new Float32Array(output.audio);
  return {
    audio: audio.slice().buffer,
    sampleRate: output.sampling_rate,
  };
}

self.onmessage = (event: MessageEvent<LocalWorkerRequest>) => {
  const { id, type, payload } = event.data;
  void (async () => {
    try {
      if (type === "load") {
        await loadModel();
        post({ id, ok: true });
        return;
      }
      if (type === "synthesize") {
        const { text, speed } = payload as { text: string; speed: number };
        const result = await synthesize(text, speed);
        post({ id, ok: true, result }, [result.audio]);
        return;
      }
      throw new Error(`Unknown Kokoro worker request: ${type}`);
    } catch (error) {
      post({ id, ok: false, error: errorMessage(error) });
    }
  })();
};
