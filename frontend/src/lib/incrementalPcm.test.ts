import { expect, it } from "vitest";
import { IncrementalPcm16 } from "./incrementalPcm";
import { floatToPcm16, resampleTo16k } from "./recorder";
function join(chunks: ArrayBuffer[]) {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
it.each([8000, 16000, 22050, 44100, 48000, 96000])("matches whole-buffer PCM byte for byte across arbitrary %i Hz chunk boundaries", rate => {
  const samples = Float32Array.from({ length: rate + 37 }, (_, i) => i % 17 === 0 ? 1.5 : i % 19 === 0 ? -1.5 : Math.sin(i * .137));
  const converter = new IncrementalPcm16(rate), chunks: ArrayBuffer[] = [];
  const sizes = [1, 3, 128, 7, 1024, 251];
  let offset = 0, index = 0;
  while (offset < samples.length) {
    const end = Math.min(samples.length, offset + sizes[index++ % sizes.length]);
    chunks.push(converter.push(samples.slice(offset, end)));
    offset = end;
  }
  expect(join(chunks).byteLength).toBeGreaterThan(0);
  chunks.push(converter.flush());
  expect(join(chunks)).toEqual(new Uint8Array(floatToPcm16(resampleTo16k(samples, rate))));
  expect(converter.flush().byteLength).toBe(0);
});
it.each([8000, 16000, 22050, 44100, 48000, 96000])("handles empty and short final clips without premature sample rounding at %i Hz", rate => {
  for (let count = 0;count < 40;count++) {
    const samples = Float32Array.from({ length: count }, (_, i) => .2 + i * .01), converter = new IncrementalPcm16(rate);
    const chunks = Array.from(samples, value => converter.push(new Float32Array([value])));
    chunks.push(converter.flush());
    expect(join(chunks)).toEqual(new Uint8Array(floatToPcm16(resampleTo16k(samples, rate))));
  }
});
