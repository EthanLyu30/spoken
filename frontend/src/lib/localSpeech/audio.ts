/** Convert little-endian signed 16-bit mono PCM to normalized Float32 samples. */
export function pcm16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const input = new Int16Array(pcm);
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    output[i] = input[i] / 32_768;
  }
  return output;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

/** Wrap mono Float32 samples in a standard 16-bit PCM WAV container. */
export function float32ToWavBlob(
  audio: Float32Array,
  sampleRate: number,
): Blob {
  const bytesPerSample = 2;
  const dataBytes = audio.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < audio.length; i++) {
    const sample = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(
      44 + i * bytesPerSample,
      sample < 0 ? sample * 32_768 : sample * 32_767,
      true,
    );
  }
  return new Blob([buffer], { type: "audio/wav" });
}
