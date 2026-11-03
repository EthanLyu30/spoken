export const MAX_AUDIO_BYTES = 180 * 16_000 * 2;
export const MAX_RECORDING_MS = 180_000;

/** Reject unusable clips before any direct-provider or backend request. */
export function assertAudioWithinLimit(pcm: ArrayBuffer): void {
  if (!pcm.byteLength) throw new Error("Empty audio");
  if (pcm.byteLength > MAX_AUDIO_BYTES) throw new Error("Audio exceeds 180 seconds");
}
