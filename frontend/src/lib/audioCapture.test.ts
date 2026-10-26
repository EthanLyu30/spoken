import { afterEach, expect, it, vi } from "vitest";
import { createCaptureProcessor } from "./audioCapture";
afterEach(() => vi.unstubAllGlobals());

it("receives PCM from the audio thread and releases its message port", async () => {
  const instances: Worklet[] = [];
  class Worklet {
    port = { onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null, close: vi.fn() };
    disconnect = vi.fn();
    constructor() { instances.push(this); }
  }
  vi.stubGlobal("AudioWorkletNode", Worklet);
  const onSamples = vi.fn();
  const context = { audioWorklet: { addModule: vi.fn(async () => {}) } };
  const processor = await createCaptureProcessor(context as unknown as AudioContext, onSamples);
  const instance = instances[0];
  instance.port.onmessage?.(new MessageEvent("message", { data: new Float32Array([0.25, -0.25]).buffer }));
  expect(Array.from(onSamples.mock.calls[0][0])).toEqual([0.25, -0.25]);
  processor.disconnect();
  expect(instance!.port.onmessage).toBeNull();
  expect(instance!.port.close).toHaveBeenCalledOnce();
});

it("keeps a small-frame capture fallback when AudioWorklet is unavailable", async () => {
  const node = { onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null, disconnect: vi.fn() };
  const createScriptProcessor = vi.fn((_size: number, _inputs: number, _outputs: number) => node);
  const onSamples = vi.fn();
  const processor = await createCaptureProcessor({ createScriptProcessor } as unknown as AudioContext, onSamples);
  expect(createScriptProcessor.mock.calls[0][0]).toBeLessThanOrEqual(1024);
  node.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array([0.5]) } } as unknown as AudioProcessingEvent);
  expect(onSamples.mock.calls[0][0][0]).toBe(0.5);
  processor.disconnect();
  expect(node.onaudioprocess).toBeNull();
});
