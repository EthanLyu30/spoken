/** Microphone capture with incremental 16 kHz / PCM16 output and a complete clip. */
import { createCaptureProcessor } from "./audioCapture";
import { IncrementalPcm16 } from "./incrementalPcm";
export { floatToPcm16, resampleTo16k } from "./incrementalPcm";
export interface ActiveRecorder {
  stop: () => Promise<ArrayBuffer>;
}
export async function startRecording(onPcm?: (pcm: ArrayBuffer) => void, signal?: AbortSignal): Promise<ActiveRecorder> {
  signal?.throwIfAborted();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  let context: AudioContext | undefined;
  let releaseProcessor: (() => void) | undefined;
  let source: MediaStreamAudioSourceNode | undefined, sink: GainNode | undefined;
  let disposed = false, closing: Promise<void> = Promise.resolve();
  function dispose() {
    if (disposed)
      return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    releaseProcessor?.();
    source?.disconnect();
    sink?.disconnect();
    stream.getTracks().forEach(track => track.stop());
    if (context)
      closing = context.close().catch(() => undefined);
  }
  signal?.addEventListener("abort", dispose, { once: true });
  try {
    signal?.throwIfAborted();
    const Ctx = window.AudioContext || (window as unknown as {
      webkitAudioContext: typeof AudioContext;
    }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: 16000 });
    context = ctx;
    await ctx.resume();
    signal?.throwIfAborted();
    source = ctx.createMediaStreamSource(stream);
    const converter = new IncrementalPcm16(ctx.sampleRate), chunks: ArrayBuffer[] = [];
    function publish(pcm: ArrayBuffer) {
      if (!pcm.byteLength)
        return;
      chunks.push(pcm);
      onPcm?.(pcm);
    }
    const processor = await createCaptureProcessor(ctx, samples => {
      if (!disposed)
        publish(converter.push(samples));
    });
    if (disposed || signal?.aborted) {
      processor.disconnect();
      signal?.throwIfAborted();
      throw new DOMException("Capture cancelled", "AbortError");
    }
    releaseProcessor = processor.disconnect;
    sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(processor.node);
    processor.node.connect(sink);
    sink.connect(ctx.destination);
    let stopping: Promise<ArrayBuffer> | null = null;
    return {
      stop: () => stopping ??= (async () => {
        // Include the last word's tail, and publish its final PCM before resolving.
        if (!disposed) {
          await new Promise(resolve => setTimeout(resolve, 80));
          if (!disposed)
            publish(converter.flush());
          dispose();
        }
        await closing;
        const pcm = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
        let offset = 0;
        for (const chunk of chunks) {
          pcm.set(new Uint8Array(chunk), offset);
          offset += chunk.byteLength;
        }
        return pcm.buffer;
      })()
    };
  }
  catch (error) {
    dispose();
    await closing;
    throw error;
  }
}
export function flatten(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
