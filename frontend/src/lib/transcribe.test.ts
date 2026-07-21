import { describe, expect, it, vi } from "vitest";
import { transcribeSpeechWith } from "./transcribe";

describe("speech transcription routing", () => {
  const pcm = new Int16Array([0, 2_000, -2_000]).buffer;

  it("uses Moonshine without calling cloud ASR when the local model is ready", async () => {
    const local = vi.fn(async () => "  hello locally  ");
    const cloud = vi.fn(async () => "hello from cloud");

    await expect(
      transcribeSpeechWith(pcm, {
        isMoonshineReady: () => true,
        moonshine: local,
        cloud,
      }),
    ).resolves.toBe("hello locally");

    expect(local).toHaveBeenCalledWith(pcm);
    expect(cloud).not.toHaveBeenCalled();
  });

  it("keeps cloud ASR while Moonshine is still loading", async () => {
    const local = vi.fn(async () => "local");
    const cloud = vi.fn(async () => "  cloud  ");

    await expect(
      transcribeSpeechWith(pcm, {
        isMoonshineReady: () => false,
        moonshine: local,
        cloud,
      }),
    ).resolves.toBe("cloud");

    expect(local).not.toHaveBeenCalled();
    expect(cloud).toHaveBeenCalledWith(pcm);
  });

  it("falls back to cloud for the same utterance if local inference fails", async () => {
    const cloud = vi.fn(async () => "recovered");

    await expect(
      transcribeSpeechWith(pcm, {
        isMoonshineReady: () => true,
        moonshine: vi.fn(async () => {
          throw new Error("worker crashed");
        }),
        cloud,
      }),
    ).resolves.toBe("recovered");

    expect(cloud).toHaveBeenCalledOnce();
  });
});
