/**
 * Hands-free "call mode": keep the mic open, detect end-of-utterance with a
 * simple energy-based VAD, then transcribe -> respond -> speak -> resume.
 * Turn-based (not full-duplex): the mic is ignored while Pip thinks/speaks.
 *
 * Resilience: the AudioContext is kept resumed (browsers suspend it when the
 * tab is backgrounded / the device changes), the mic is re-acquired if its
 * track drops, and each turn's transcribe/respond is retried once on a blip.
 */
import { flatten, floatToPcm16, resampleTo16k } from "./recorder";
import { openAsrStream, type AsrStream } from "./asrStream";
import { createCaptureProcessor, type CaptureProcessor } from "./audioCapture";
import { bindInteraction, newInteractionId, reportTiming } from "./telemetry";

export type CallPhase = "listening" | "thinking" | "speaking";

export interface CallCallbacks {
  onPhase: (p: CallPhase) => void;
  /** Buffered transcription using the engine selected at utterance start. */
  transcribe: (pcm: ArrayBuffer, engine: "local" | "cloud", signal: AbortSignal) => Promise<string>;
  /** Read once when speech starts; the selected engine is fixed for that turn. */
  preferLocalAsr?: () => boolean;
  /**
   * Live, growing transcript while the user is still speaking. Best-effort:
   * only fires when streaming ASR is available, so the UI must treat it as a
   * preview that's superseded by the final transcribe/reply.
   */
  onPartial?: (text: string) => void;
  /**
   * Generate Pip's reply to `userText` AND speak it (sentence-by-sentence).
   * Resolves once the whole reply has finished playing. `onSpeaking` fires when
   * the first audio is about to play, so the caller can flip the phase chip from
   * "thinking" to "speaking". Folding generation + speech into one step lets the
   * first sentence play while the rest is still being generated.
   */
  reply: (
    userText: string,
    pcm: ArrayBuffer,
    onSpeaking: () => void,
    signal: AbortSignal,
  ) => Promise<void>;
  /**
   * Barge-in: the user started talking over Pip. Called while in the "speaking"
   * phase; the caller should stop the in-flight read-aloud so the user can take
   * the turn back. Optional — barge-in is only armed when this is provided.
   */
  interrupt?: () => void;
  onError: (message: string) => void;
}

export interface VoiceCall {
  end: () => void;
}

const SILENCE_THRESHOLD = 0.012; // RMS below this counts as silence
const END_SILENCE_MS = 650;
const MIN_SPEECH_MS = 180; // include brief answers such as "yes" and "no"
const MAX_UTTER_MS = 15000; // safety cap
const LEADING_SILENCE_DROP_MS = 4000; // drop long leading silence
const KEEPALIVE_MS = 3000; // poll to resume a suspended context
const MAX_RECONNECT = 3;
// Barge-in: let the user cut in while Pip is speaking. We require a clearly
// LOUDER and SUSTAINED signal than the normal VAD, because the mic still picks
// up some of Pip's own voice from the speakers (even with echo cancellation on);
// a low bar would make Pip interrupt itself. Tune these if real-world testing
// shows misfires (raise) or sluggish cut-ins (lower).
const BARGE_IN_RMS = 0.05; // must be well above residual TTS echo
const BARGE_IN_MS = 240;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retryOnce<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch {
    signal.throwIfAborted();
    return await fn();
  }
}

export async function startVoiceCall(cb: CallCallbacks): Promise<VoiceCall> {
  const AudioCtx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  let ended = false;
  let busy = false; // ignore mic while thinking / speaking
  let speaking = false; // Pip is currently reading a reply aloud (barge-in armed)
  let bargeMs = 0; // accumulated loud-speech time during Pip's turn
  let reconnecting = false;
  let rate = 16000;
  let graphGeneration = 0;
  let turnGeneration = 0;
  let turnController: AbortController | null = null;
  let bargeFrames: Float32Array[] = [];

  // Streaming ASR (live captions + zero re-upload). Best-effort: if the relay
  // is unavailable we fall back to buffering the clip and POSTing it.
  let asr: AsrStream | null = null;
  let asrUnavailable = false;
  let asrOpening: Promise<void> | null = null;
  let asrGeneration = 0;

  function invalidateCloudStream(): void {
    asrGeneration += 1;
    asr?.close();
    asr = null;
  }

  function ensureStream(): Promise<void> {
    if (asr || asrUnavailable || ended) return Promise.resolve();
    if (asrOpening) return asrOpening;

    const generation = asrGeneration;
    let opened: AsrStream | null = null;
    const opening = (async () => {
      try {
        opened = await openAsrStream({
          onPartial: (t) => {
            if (!ended && !busy) cb.onPartial?.(t);
          },
          onClose: () => {
            if (asr === opened) asr = null;
          },
        });
        if (ended || generation !== asrGeneration || busy || !started) {
          opened.close();
          return;
        }
        asr = opened;
      } catch {
        if (generation === asrGeneration) {
          asr = null;
          asrUnavailable = true;
        }
      }
    })();
    asrOpening = opening;
    void opening.then(() => {
      if (asrOpening === opening) asrOpening = null;
    });
    return opening;
  }

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: CaptureProcessor | null = null;
  let sink: GainNode | null = null;

  // VAD state for the current utterance.
  let collected: Float32Array[] = [];
  let speechMs = 0;
  let silenceMs = 0;
  let utterMs = 0;
  let started = false;
  let utteranceUsesLocalAsr = false;
  let cloudFramesSent = 0;

  const reset = () => {
    collected = [];
    speechMs = 0;
    silenceMs = 0;
    utterMs = 0;
    started = false;
    utteranceUsesLocalAsr = false;
    cloudFramesSent = 0;
  };

  const selectAsr = () => {
    utteranceUsesLocalAsr = cb.preferLocalAsr?.() ?? false;
    if (utteranceUsesLocalAsr) invalidateCloudStream();
    else void ensureStream();
  };

  const handle = async (pcm: ArrayBuffer, useLocalAsr: boolean) => {
    const startedAt = performance.now();
    const interactionId = newInteractionId();
    let outcome: "ok" | "error" | "cancelled" = "ok";
    let firstAudio = false;
    const generation = ++turnGeneration;
    const controller = new AbortController();
    turnController = controller;
    const { signal } = controller;
    bindInteraction(signal, interactionId);
    if (asr) bindInteraction(asr, interactionId);
    busy = true;
    bargeFrames = [];
    try {
      cb.onPhase("thinking");
      // Prefer the streaming final (already mid-flight); fall back to a buffered
      // POST if streaming is unavailable or yielded nothing.
      let text = "";
      if (!useLocalAsr && asr) {
        try {
          text = (await asr.finishUtterance()).trim();
        } catch {
          text = "";
        }
      }
      if (!text) {
        text = (
          await retryOnce(() =>
            cb.transcribe(pcm, useLocalAsr ? "local" : "cloud", signal),
            signal,
          )
        ).trim();
      }
      if (text && !ended && !signal.aborted) {
        // reply() generates and speaks the answer; it flips us to "speaking"
        // (via the callback) as soon as the first sentence starts. That's also
        // when we arm barge-in so the user can talk over Pip.
        await cb.reply(text, pcm, () => {
          if (ended || signal.aborted || generation !== turnGeneration) return;
          if (!firstAudio) {
            firstAudio = true;
            reportTiming("voice.first_audio", performance.now() - startedAt, { interactionId });
          }
          speaking = true;
          bargeMs = 0;
          cb.onPhase("speaking");
        }, signal);
      } else outcome = signal.aborted || ended ? "cancelled" : "error";
    } catch {
      outcome = signal.aborted || ended ? "cancelled" : "error";
      if (!ended && !signal.aborted) cb.onError("这一句没接上，继续说就好～");
    } finally {
      reportTiming("voice.complete", performance.now() - startedAt, { interactionId, outcome: signal.aborted ? "cancelled" : outcome });
      if (generation === turnGeneration) {
        busy = false;
        speaking = false;
        bargeMs = 0;
        bargeFrames = [];
        if (!ended) cb.onPhase("listening");
      }
    }
  };

  /** Hand the turn back to the user: stop Pip's audio and resume listening. */
  const triggerBargeIn = () => {
    if (ended || !speaking) return;
    const buffered = bargeFrames;
    const speechDuration = bargeMs;
    turnGeneration += 1;
    turnController?.abort();
    speaking = false;
    bargeMs = 0;
    busy = false; // reopen the mic immediately for the user's new utterance
    reset();
    collected = buffered;
    utterMs = buffered.reduce((sum, frame) => sum + frame.length / rate * 1000, 0);
    speechMs = speechDuration;
    started = true;
    bargeFrames = [];
    selectAsr();
    cb.interrupt?.(); // stop the in-flight read-aloud
    if (!ended) cb.onPhase("listening");
  };

  /** While Pip speaks, watch for a clear, sustained signal the user is cutting in. */
  const detectBargeIn = (rms: number, frameMs: number) => {
    if (rms > BARGE_IN_RMS) {
      bargeMs += frameMs;
      if (bargeMs >= BARGE_IN_MS) triggerBargeIn();
    } else {
      bargeMs = Math.max(0, bargeMs - frameMs); // let isolated echo spikes decay
    }
  };

  const onAudio = (buf: Float32Array) => {
    if (ended || reconnecting) return;
    const frameMs = (buf.length / rate) * 1000;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);

    if (busy) {
      // Mic is otherwise ignored while Pip thinks/speaks — but during "speaking"
      // we listen for the user cutting in (barge-in), if the caller supports it.
      if (speaking && cb.interrupt) {
        bargeFrames.push(new Float32Array(buf));
        // Retain the lead-in, including the frame which triggers the handoff.
        while (bargeFrames.length > 1 && bargeFrames.reduce((sum, frame) => sum + frame.length / rate * 1000, 0) > 1_000) bargeFrames.shift();
        detectBargeIn(rms, frameMs);
      }
      return;
    }

    collected.push(new Float32Array(buf));
    utterMs += frameMs;

    if (rms > SILENCE_THRESHOLD) {
      if (!started) {
        selectAsr();
      }
      speechMs += frameMs;
      silenceMs = 0;
      started = true;
    } else if (started) {
      silenceMs += frameMs;
    }

    if (!started && utterMs > LEADING_SILENCE_DROP_MS) {
      reset();
      return;
    }

    // Once the user is actually speaking, forward each frame live so iFlytek
    // transcribes in real time (captions) and the final is ready the instant
    // they stop — no separate upload round-trip.
    if (started && asr && !utteranceUsesLocalAsr) {
      const currentStream = asr;
      for (; cloudFramesSent < collected.length; cloudFramesSent++) {
        currentStream.send(floatToPcm16(resampleTo16k(collected[cloudFramesSent], rate)));
      }
    }

    const done =
      started &&
      ((speechMs > MIN_SPEECH_MS && silenceMs > END_SILENCE_MS) || utterMs > MAX_UTTER_MS);
    if (done) {
      const pcm = floatToPcm16(resampleTo16k(flatten(collected), rate));
      const useLocalAsr = utteranceUsesLocalAsr;
      reset();
      void handle(pcm, useLocalAsr);
    }
  };

  async function acquireMic() {
    const generation = graphGeneration;
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    if (ended || generation !== graphGeneration) {
      acquired.getTracks().forEach((track) => track.stop());
      return false;
    }
    stream = acquired;
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (!ended) void reconnect("麦克风已断开");
      };
    }
    return true;
  }

  async function buildGraph() {
    if (!stream) throw new Error("no stream");
    const generation = graphGeneration;
    const audioContext = new AudioCtx({ sampleRate: 16000 });
    ctx = audioContext;
    await audioContext.resume();
    if (ended || generation !== graphGeneration) { await audioContext.close().catch(() => undefined); return false; }
    const audioProcessor = await createCaptureProcessor(audioContext, onAudio);
    if (ended || generation !== graphGeneration) {
      audioProcessor.disconnect();
      await audioContext.close().catch(() => undefined);
      return false;
    }
    rate = audioContext.sampleRate;
    source = audioContext.createMediaStreamSource(stream);
    processor = audioProcessor;
    sink = audioContext.createGain();
    sink.gain.value = 0;
    source.connect(processor.node);
    processor.node.connect(sink);
    sink.connect(audioContext.destination);
    return true;
  }

  function teardownGraph() {
    graphGeneration += 1;
    try {
      processor?.disconnect();
      source?.disconnect();
      sink?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      stream?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    } catch {
      /* ignore */
    }
    try {
      void ctx?.close().catch(() => undefined);
    } catch {
      /* ignore */
    }
    processor = null;
    source = sink = null;
    ctx = null;
    stream = null;
  }

  async function reconnect(reason: string) {
    if (ended || reconnecting) return;
    reconnecting = true;
    busy = false;
    cb.onError(`${reason}，正在重连…`);
    teardownGraph();
    reset();
    for (let attempt = 1; attempt <= MAX_RECONNECT && !ended; attempt++) {
      try {
        if (!(await acquireMic()) || !(await buildGraph())) { reconnecting = false; return; }
        reconnecting = false;
        if (!ended) cb.onPhase("listening");
        return;
      } catch {
        teardownGraph();
        if (!ended) await delay(700 * attempt);
      }
    }
    reconnecting = false;
    if (!ended) cb.onError("麦克风重连失败，请切回打字，或重新开始通话。");
  }

  // Initial setup (errors propagate to the caller, which shows a hint).
  try {
    if (!(await acquireMic()) || !(await buildGraph())) throw new DOMException("Call cancelled", "AbortError");
  } catch (error) {
    teardownGraph();
    throw error;
  }
  cb.onPhase("listening");

  // Open cloud ASR at speech onset. An idle direct-provider socket expires
  // before a learner who pauses to think has sent any audio.

  // Keep the context alive: browsers suspend it when backgrounded / on device
  // changes, which would silently freeze the call.
  const keepAlive = setInterval(() => {
    if (ended || reconnecting) return;
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => undefined);
  }, KEEPALIVE_MS);

  return {
    end: () => {
      ended = true;
      turnGeneration += 1;
      turnController?.abort();
      clearInterval(keepAlive);
      invalidateCloudStream();
      teardownGraph();
    },
  };
}
