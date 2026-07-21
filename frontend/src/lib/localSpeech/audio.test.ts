import { describe, expect, it } from "vitest";
import { float32ToWavBlob, pcm16ToFloat32 } from "./audio";

describe("local speech audio conversion", () => {
  it("normalizes signed 16-bit PCM for Moonshine", () => {
    const pcm = new Int16Array([-32_768, -16_384, 0, 16_384, 32_767]);

    expect([...pcm16ToFloat32(pcm.buffer)]).toEqual([
      -1,
      -0.5,
      0,
      0.5,
      32_767 / 32_768,
    ]);
  });

  it("encodes Kokoro Float32 output as a playable mono WAV", async () => {
    const blob = float32ToWavBlob(
      new Float32Array([-1, -0.5, 0, 0.5, 1]),
      24_000,
    );
    const view = new DataView(await blob.arrayBuffer());
    const text = (offset: number, length: number) =>
      String.fromCharCode(
        ...new Uint8Array(view.buffer, offset, length),
      );

    expect(blob.type).toBe("audio/wav");
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(52, true)).toBe(32_767);
  });
});
