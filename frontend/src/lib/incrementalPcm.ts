/** Canonical whole-buffer conversion, also retained by recorder's legacy exports. */
export function resampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === 16000 || input.length === 0)
    return input;
  const ratio = inRate / 16000;
  const out = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0;i < out.length;i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx), i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}
export function floatToPcm16(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2), view = new DataView(buf);
  for (let i = 0;i < input.length;i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
/** Retry an empty recognition result only when the retained 16 kHz PCM contains
 * sustained sound. Ignore microphone DC offset and isolated clicks. */
export function hasSustainedAudio(pcm: ArrayBuffer): boolean {
  const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
  const frame = 320; // 20 ms
  const minVariance = (32768 * 0.008) ** 2;
  let activeFrames = 0;
  for (let start = 0; start + frame <= samples.length; start += frame) {
    let sum = 0, squares = 0;
    for (let i = start; i < start + frame; i++) {
      sum += samples[i];
      squares += samples[i] ** 2;
    }
    const variance = squares / frame - (sum / frame) ** 2;
    activeFrames = variance >= minVariance ? activeFrames + 1 : 0;
    if (activeFrames >= 4) return true;
  }
  return false;
}

/** Absolute output indices avoid per-block rounding and accumulated float drift. */
export class IncrementalPcm16 {
  private readonly ratio: number;
  private samples = new Float32Array(0);
  private base = 0;
  private received = 0;
  private output = 0;
  private finished = false;
  constructor(rate: number) {
    if (!Number.isFinite(rate) || rate <= 0)
      throw new Error("Unsupported capture sample rate");
    this.ratio = rate / 16000;
  }
  push(samples: Float32Array): ArrayBuffer {
    if (this.finished)
      return new ArrayBuffer(0);
    const next = new Float32Array(this.samples.length + samples.length);
    next.set(this.samples);
    next.set(samples, this.samples.length);
    this.samples = next;
    this.received += samples.length;
    return this.convert(false);
  }
  flush(): ArrayBuffer {
    if (this.finished)
      return new ArrayBuffer(0);
    this.finished = true;
    return this.convert(true);
  }
  private convert(final: boolean): ArrayBuffer {
    const limit = Math.round(this.received / this.ratio);
    const output: number[] = [];
    while (this.output < limit) {
      const index = this.output * this.ratio, lower = Math.floor(index), fraction = index - lower;
      // Interpolation needs the next sample unless this position is exact.
      if (!final && fraction !== 0 && lower + 1 >= this.received)
        break;
      const upper = Math.min(lower + 1, this.received - 1);
      output.push(this.samples[lower - this.base] * (1 - fraction) + this.samples[upper - this.base] * fraction);
      this.output++;
    }
    const keepFrom = Math.max(this.base, Math.min(Math.floor(this.output * this.ratio), this.received - 1));
    this.samples = this.samples.slice(keepFrom - this.base);
    this.base = keepFrom;
    // Match whole-buffer Float32 rounding before conversion to signed PCM16.
    return floatToPcm16(new Float32Array(output));
  }
}
