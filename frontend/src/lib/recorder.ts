/**
 * Microphone capture that yields 16 kHz / 16-bit / mono PCM — the format
 * iFlytek ASR expects. Prefers AudioWorklet with a small-buffer fallback and resamples
 * from the device rate if the browser ignores the requested 16 kHz context.
 */
import { createCaptureProcessor } from "./audioCapture";
export interface ActiveRecorder {
  stop: () => Promise<ArrayBuffer>;
}

export async function startRecording(): Promise<ActiveRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const Ctx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let context: AudioContext | undefined;
  let releaseProcessor: (() => void) | undefined;
  try {
    const ctx = new Ctx({ sampleRate: 16000 });
    context = ctx;
    await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const chunks: Float32Array[] = [];
    const processor = await createCaptureProcessor(ctx, (samples) => chunks.push(samples));
    releaseProcessor = processor.disconnect;
    const sink = ctx.createGain();
    sink.gain.value = 0; // process without audible playback

    source.connect(processor.node);
    processor.node.connect(sink);
    sink.connect(ctx.destination);

    let stopping: Promise<ArrayBuffer> | null = null;
    return {
      stop: () => stopping ??= (async () => {
        // Capture the final audio frame and the tail of the last spoken word.
        await new Promise((r) => setTimeout(r, 80));
        processor.disconnect();
        source.disconnect();
        sink.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        const rate = ctx.sampleRate;
        await ctx.close();
        return floatToPcm16(resampleTo16k(flatten(chunks), rate));
      })(),
    };
  } catch (error) {
    releaseProcessor?.();
    stream.getTracks().forEach((track) => track.stop());
    await context?.close().catch(() => undefined);
    throw error;
  }
}

export function flatten(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function resampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === 16000 || input.length === 0) return input;
  const ratio = inRate / 16000;
  const outLen = Math.round(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export function floatToPcm16(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); // little-endian
  }
  return buf;
}
