import { postAsr } from "./api";
import { openAsrStream, type AsrStream } from "./asrStream";
import { isLocalSpeechModelReady, localSpeechCoordinator } from "./localSpeech/runtime";
import { useVoice } from "../store/voice";
import { getInteraction, bindInteraction, newInteractionId, reportTiming, type Transport } from "./telemetry";
import { isAsrQuotaError } from "./asrQuota";
import { withTimeout } from "./requestTimeout";
import { assertAuthGeneration, getAuthGeneration } from "./authToken";
import { asrFailure } from "./asrDiagnostics";

interface TranscriptionBackends {
  isMoonshineReady: () => boolean;
  moonshine: (pcm: ArrayBuffer) => Promise<string>;
  cloud: (pcm: ArrayBuffer) => Promise<string>;
}

export async function transcribeSpeechWith(
  pcm: ArrayBuffer,
  backends: TranscriptionBackends,
  signal?: AbortSignal,
): Promise<string> {
  const generation = getAuthGeneration();
  assertAuthGeneration(generation, signal);
  if (backends.isMoonshineReady()) {
    try {
      const localText = (await backends.moonshine(pcm)).trim();
      assertAuthGeneration(generation, signal);
      if (localText) return localText;
    } catch (error) {
      assertAuthGeneration(generation, signal);
      signal?.throwIfAborted();
      if ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError") throw error;
      // A worker can be evicted/crash independently. Recover this utterance via
      // the existing API instead of surfacing a broken recording to the user.
    }
  }
  assertAuthGeneration(generation, signal);
  const text = (await backends.cloud(pcm)).trim();
  assertAuthGeneration(generation, signal);
  return text;
}

export interface LiveTranscription {
  /** The id assigned when this microphone turn started. */
  readonly interactionId?: string;
  /** Actual latest route, including complete-recording recovery. */
  readonly transport?: Transport;
  /** Feed captured PCM while the microphone is still recording. */
  send: (pcm: ArrayBuffer) => void;
  /** Finish the utterance and return its transcript, buffered only on failure. */
  finish: (pcm: ArrayBuffer, signal?: AbortSignal) => Promise<string>;
  close: () => void;
}

/** A partial is editable recovery text, never a confirmed answer. */
export class IncompleteTranscriptionError extends Error {
  constructor(readonly partialText: string) {
    super("语音识别不完整，请确认补全后发送，或重新录音。");
    this.name = "IncompleteTranscriptionError";
  }
}

/**
 * Start one provider stream at recording start instead of replaying the clip
 * after Stop. Audio received before the socket opens is queued and flushed in
 * order; if the stream cannot open, `finish` recovers through buffered ASR.
 */
export function createLiveTranscription(signal?: AbortSignal): LiveTranscription {
  let stream: AsrStream | null = null;
  let closed = false;
  let openError: unknown;
  let latest = "";
  let transport: Transport = "unknown";
  const onTransport = (actual: "direct" | "buffered") => { transport = actual; };
  const queue: ArrayBuffer[] = [];
  const control = new AbortController();
  if (signal?.aborted) control.abort(signal.reason);
  const interactionId = getInteraction(signal) ?? newInteractionId();
  if (interactionId) bindInteraction(control.signal, interactionId);
  const abort = () => control.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const opened = openAsrStream(
    { onPartial: (text) => { latest = text; } },
    "en_us",
    control.signal,
  ).then((openedStream) => {
    if (control.signal.aborted) {
      openedStream.close();
      return null;
    }
    stream = openedStream;
    transport = openedStream.transport ?? "unknown";
    for (const pcm of queue) openedStream.send(pcm);
    queue.length = 0;
    return openedStream;
  }).catch(error => { openError = error; return null; });
  return {
    interactionId,
    get transport() { return transport; },
    send(pcm) {
      if (closed) return;
      if (stream) stream.send(pcm);
      else queue.push(pcm);
    },
    async finish(pcm, finishSignal) {
      closed = true;
      bindInteraction(control.signal, interactionId ?? getInteraction(finishSignal));
      const cancel = () => control.abort(finishSignal?.reason);
      finishSignal?.addEventListener("abort", cancel, { once: true });
      const recover = async () => {
        const text = (await postAsr(pcm, control.signal, onTransport)).trim();
        control.signal.throwIfAborted();
        return text;
      };
      try {
        const openedStream = stream ?? await opened;
        control.signal.throwIfAborted();
        finishSignal?.throwIfAborted();
        if (!openedStream) {
          if (isAsrQuotaError(openError)) throw openError;
          return await recover();
        }
        try {
          const text = (await openedStream.finishUtterance()).trim();
          control.signal.throwIfAborted();
          if (!text && latest.trim()) throw new IncompleteTranscriptionError(latest.trim());
          return text;
        } catch (error) {
          const partial = latest.trim();
          if (isAsrQuotaError(error)) {
            if (partial) error.partialText = partial;
            throw error;
          }
          if (finishSignal?.aborted || control.signal.aborted ||
              (error instanceof Error && error.name === "AbortError")) throw error;
          // A deploy can close the relay mid-utterance. Prefer the complete
          // recording; an unconfirmed partial must never be auto-submitted.
          try {
            const recovered = await recover();
            if (recovered || !partial) return recovered;
          } catch (recoveryError) {
            if (isAsrQuotaError(recoveryError)) {
              if (partial) recoveryError.partialText = partial;
              throw recoveryError;
            }
            if (finishSignal?.aborted || control.signal.aborted ||
                (recoveryError instanceof Error && recoveryError.name === "AbortError")) throw recoveryError;
            if (!partial) throw recoveryError;
          }
          throw new IncompleteTranscriptionError(partial);
        } finally {
          openedStream.close();
        }
      } finally {
        finishSignal?.removeEventListener("abort", cancel);
        signal?.removeEventListener("abort", abort);
        if (finishSignal?.aborted) control.abort(finishSignal.reason);
      }
    },
    close() {
      closed = true;
      control.abort();
      stream?.close();
      queue.length = 0;
      signal?.removeEventListener("abort", abort);
    },
  };
}

/** One bounded cloud recovery chain, including two possible 1/4-speed uploads. */
export function asrTurnBudgetMs(pcm: ArrayBuffer): number {
  const frames = Math.ceil(pcm.byteLength / 1280);
  return Math.min(105_000, Math.max(20_000, 12_000 + frames * 20));
}

export async function transcribeSpeech(
  pcm: ArrayBuffer,
  signal?: AbortSignal,
  mode: "auto" | "cloud" = "auto",
  live?: LiveTranscription,
): Promise<string> {
  const generation = getAuthGeneration();
  const start = performance.now();
  const turnSignal = withTimeout(signal, asrTurnBudgetMs(pcm));
  const interactionId = live?.interactionId ?? getInteraction(signal) ?? newInteractionId();
  if (turnSignal) bindInteraction(turnSignal, interactionId);
  const measurement: { engine: "local" | "xfyun" | "unknown"; transport: Transport } = { engine: "unknown", transport: "unknown" };
  // A live stream wins unless the learner explicitly prepared the local model.
  // The stream already contains the whole utterance, so there is no replay.
  const useLive = !!live && !(mode !== "cloud" && isMoonshineTranscriptionReady());
  if (live && !useLive) live.close();
  try {
    assertAuthGeneration(generation, turnSignal);
    let text: string;
    if (useLive && live) {
      measurement.engine = "xfyun";
      text = (await live.finish(pcm, turnSignal)).trim();
    } else {
      text = await transcribeSpeechWith(pcm, {
        isMoonshineReady: () => mode !== "cloud" && isMoonshineTranscriptionReady(),
        moonshine: async (audio) => {
          measurement.engine = "local";
          measurement.transport = "local";
          const { transcribeWithMoonshine } = await import(
            "./localSpeech/moonshine"
          );
          assertAuthGeneration(generation, turnSignal);
          try { return await transcribeWithMoonshine(audio); }
          catch (error) { assertAuthGeneration(generation, turnSignal); localSpeechCoordinator.markError("moonshine",error); throw error; }
        },
        cloud: (audio) => {
          measurement.engine = "xfyun";
          measurement.transport = "unknown";
          return postAsr(audio, turnSignal, transport => { measurement.transport = transport; });
        },
      }, turnSignal);
    }
    assertAuthGeneration(generation, turnSignal);
    reportTiming("asr.transcribe", performance.now() - start, {
      engine: measurement.engine,
      interactionId,
      transport: useLive ? live?.transport ?? "unknown" : measurement.transport,
      ...(text ? { outcome: "ok" } : { outcome: "error", asr_reason: "empty" }),
    });
    return text;
  } catch (error) {
    if (live && !useLive) live.close();
    reportTiming("asr.transcribe", performance.now() - start, {
      engine: measurement.engine, interactionId,
      transport: useLive ? live?.transport ?? "unknown" : measurement.transport,
      ...asrFailure(error, turnSignal ?? signal, generation !== getAuthGeneration()),
    });
    throw error;
  }
}

/** Snapshot this at utterance start so an in-flight cloud turn is not mixed. */
export function isMoonshineTranscriptionReady(): boolean {
  return useVoice.getState().engine === "local" && isLocalSpeechModelReady("moonshine");
}
