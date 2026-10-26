import { expect, it, vi } from "vitest";
import { createPcmPlayback } from "./pcmPlayback";

function audioContext() {
  const sources: Array<{ buffer: { duration: number; samples: Float32Array } | null; onended: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn> }> = [];
  const context = {
    currentTime: 1, destination: {}, close: vi.fn(async () => {}),
    createBuffer: (_channels: number, length: number, rate: number) => {
      const samples = new Float32Array(length);
      return { samples, duration: length / rate, getChannelData: () => samples };
    },
    createBufferSource: () => {
      const source = { buffer: null, onended: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn() } as typeof sources[number];
      sources.push(source);
      return source;
    },
  };
  return { context, sources };
}

it("plays the first PCM frame before the response completes, preserving split samples", async () => {
  const { context, sources } = audioContext();
  const playback = createPcmPlayback(context as unknown as AudioContext);
  playback.push(new Uint8Array([0, 64, 0]));
  expect(sources).toHaveLength(1);
  expect(sources[0].buffer?.samples[0]).toBe(0.5);
  playback.push(new Uint8Array([128]));
  expect(sources[1].buffer?.samples[0]).toBe(-1);
  expect(sources[1].start.mock.calls[0][0]).toBeCloseTo(sources[0].start.mock.calls[0][0] + 1 / 16000);
  const done = playback.finish();
  sources.forEach((source) => source.onended?.());
  await done;
  expect(context.close).toHaveBeenCalledOnce();
});

it("stops all queued sources and ignores late network audio", async () => {
  const { context, sources } = audioContext();
  const playback = createPcmPlayback(context as unknown as AudioContext);
  playback.push(new Uint8Array([0, 64]));
  playback.stop();
  playback.push(new Uint8Array([0, 64]));
  await playback.finish();
  expect(sources).toHaveLength(1);
  expect(sources[0].stop).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
});

it("rejects an incomplete final PCM sample", async () => {
  const { context } = audioContext();
  const playback = createPcmPlayback(context as unknown as AudioContext);
  playback.push(new Uint8Array([1]));
  await expect(playback.finish()).rejects.toThrow(/incomplete/i);
  playback.stop();
});
