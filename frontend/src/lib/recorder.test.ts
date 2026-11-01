import { afterEach, expect, it, vi } from "vitest";
import { startRecording, floatToPcm16, resampleTo16k } from "./recorder";
import * as capture from "./audioCapture";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
it.each(["constructor", "processor"])("releases the acquired microphone when %s initialization fails", async (failure) => {
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  class Context {
    sampleRate = 16000;
    constructor() {
      if (failure === "constructor")
        throw new Error("unsupported context");
    }
    async resume() { }
    async close() { }
    createMediaStreamSource() { return { disconnect: vi.fn() }; }
    createScriptProcessor() { throw new Error("unsupported processor"); }
  }
  vi.stubGlobal("AudioContext", Context);
  await expect(startRecording()).rejects.toThrow(/unsupported/);
  expect(stop).toHaveBeenCalledOnce();
});
function microphone(rate = 44100) {
  const trackStop = vi.fn(), close = vi.fn().mockResolvedValue(undefined), disconnect = vi.fn();
  let emit!: (samples: Float32Array) => void;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] })) } });
  class Context {
    sampleRate = rate;
    destination = {};
    close = close;
    async resume() { }
    createMediaStreamSource() { return { connect: vi.fn(), disconnect }; }
    createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect }; }
  }
  vi.stubGlobal("AudioContext", Context);
  vi.spyOn(capture, "createCaptureProcessor").mockImplementation(async (_ctx, onSamples) => {
    emit = onSamples;
    return { node: { connect: vi.fn() } as unknown as AudioNode, disconnect };
  });
  return { trackStop, close, emit: (samples: Float32Array) => emit(samples) };
}
it("emits PCM during recording and includes the 80ms tail before stop resolves with identical bytes", async () => {
  vi.useFakeTimers();
  const mic = microphone(), chunks: ArrayBuffer[] = [];
  const rec = await startRecording(chunk => chunks.push(chunk));
  const first = Float32Array.from({ length: 1001 }, (_, i) => Math.sin(i)), tail = new Float32Array([.1, .2, .3, .4, .5]);
  mic.emit(first);
  expect(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)).toBeGreaterThan(0);
  const stopped = rec.stop();
  expect(rec.stop()).toBe(stopped);
  mic.emit(tail);
  await vi.advanceTimersByTimeAsync(80);
  const pcm = await stopped;
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  const all = new Float32Array(first.length + tail.length);
  all.set(first);
  all.set(tail, first.length);
  expect(bytes).toEqual(new Uint8Array(floatToPcm16(resampleTo16k(all, 44100))));
  expect(new Uint8Array(pcm)).toEqual(bytes);
  expect(mic.trackStop).toHaveBeenCalledTimes(1);
  expect(mic.close).toHaveBeenCalledTimes(1);
});
it("releases a microphone granted after capture was cancelled", async () => {
  const mic = microphone(), controller = new AbortController();
  let grant!: (stream: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise(resolve => { grant = resolve; }));
  const checked = expect(startRecording(undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  grant({ getTracks: () => [{ stop: mic.trackStop }] } as unknown as MediaStream);
  await checked;
  expect(mic.trackStop).toHaveBeenCalledTimes(1);
  expect(mic.close).not.toHaveBeenCalled();
});
it("releases live capture immediately on abort without waiting for the stop tail", async () => {
  const mic = microphone(), controller = new AbortController(), onPcm = vi.fn();
  await startRecording(onPcm, controller.signal);
  controller.abort();
  expect(mic.trackStop).toHaveBeenCalledTimes(1);
  expect(mic.close).toHaveBeenCalledTimes(1);
  mic.emit(new Float32Array([.5, .2]));
  expect(onPcm).not.toHaveBeenCalled();
});
