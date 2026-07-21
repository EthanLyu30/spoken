const MAX_TTS_REALTIME_FACTOR = 1.25;
const MAX_ASR_REALTIME_FACTOR = 1;

function realtimeFactor({
  elapsedMs,
  sampleCount,
  sampleRate,
}: {
  elapsedMs: number;
  sampleCount: number;
  sampleRate: number;
}): number | null {
  if (
    !Number.isFinite(elapsedMs) ||
    !Number.isFinite(sampleCount) ||
    !Number.isFinite(sampleRate) ||
    elapsedMs < 0 ||
    sampleCount <= 0 ||
    sampleRate <= 0
  ) {
    return null;
  }
  const audioDurationMs = (sampleCount / sampleRate) * 1_000;
  return elapsedMs / audioDurationMs;
}

export function isTtsFastEnough({
  elapsedMs,
  sampleCount,
  sampleRate,
}: {
  elapsedMs: number;
  sampleCount: number;
  sampleRate: number;
}): boolean {
  const factor = realtimeFactor({ elapsedMs, sampleCount, sampleRate });
  return factor !== null && factor <= MAX_TTS_REALTIME_FACTOR;
}

export function isAsrFastEnough({
  elapsedMs,
  sampleCount,
  sampleRate,
}: {
  elapsedMs: number;
  sampleCount: number;
  sampleRate: number;
}): boolean {
  const factor = realtimeFactor({ elapsedMs, sampleCount, sampleRate });
  return factor !== null && factor <= MAX_ASR_REALTIME_FACTOR;
}
