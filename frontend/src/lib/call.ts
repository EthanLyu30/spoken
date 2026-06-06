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

export type CallPhase = "listening" | "thinking" | "speaking";

export interface CallCallbacks {
  onPhase: (p: CallPhase) => void;
  transcribe: (pcm: ArrayBuffer) => Promise<string>;
  respond: (userText: string) => Promise<string>;
  speak: (text: string) => Promise<void>;
  onError: (message: string) => void;
}

export interface VoiceCall {
  end: () => void;
}

const SILENCE_THRESHOLD = 0.012; // RMS below this counts as silence
const END_SILENCE_MS = 1100; // pause that ends an utterance
const MIN_SPEECH_MS = 350; // ignore blips shorter than this
const MAX_UTTER_MS = 15000; // safety cap
const LEADING_SILENCE_DROP_MS = 4000; // drop long leading silence
const KEEPALIVE_MS = 3000; // poll to resume a suspended context
const MAX_RECONNECT = 3;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

export async function startVoiceCall(cb: CallCallbacks): Promise<VoiceCall> {
  const AudioCtx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

  let ended = false;
  let busy = false; // ignore mic while thinking / speaking
  let reconnecting = false;
  let rate = 16000;

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let sink: GainNode | null = null;

  // VAD state for the current utterance.
  let collected: Float32Array[] = [];
  let speechMs = 0;
  let silenceMs = 0;
  let utterMs = 0;
  let started = false;

  const reset = () => {
    collected = [];
    speechMs = 0;
    silenceMs = 0;
    utterMs = 0;
    started = false;
  };

  const handle = async (pcm: ArrayBuffer) => {
    busy = true;
    try {
      cb.onPhase("thinking");
      const text = (await retryOnce(() => cb.transcribe(pcm))).trim();
      if (text) {
        const reply = await retryOnce(() => cb.respond(text));
        if (!ended) {
          cb.onPhase("speaking");
          await cb.speak(reply);
        }
      }
    } catch {
      if (!ended) cb.onError("这一句没接上，继续说就好～");
    } finally {
      busy = false;
      if (!ended) cb.onPhase("listening");
    }
  };

  const onAudio = (e: AudioProcessingEvent) => {
    if (ended || busy || reconnecting) return;
    const buf = e.inputBuffer.getChannelData(0);
    const frameMs = (buf.length / rate) * 1000;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);

    collected.push(new Float32Array(buf));
    utterMs += frameMs;

    if (rms > SILENCE_THRESHOLD) {
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

    const done =
      started &&
      ((speechMs > MIN_SPEECH_MS && silenceMs > END_SILENCE_MS) || utterMs > MAX_UTTER_MS);
    if (done) {
      const pcm = floatToPcm16(resampleTo16k(flatten(collected), rate));
      reset();
      void handle(pcm);
    }
  };

  async function acquireMic() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (!ended) void reconnect("麦克风已断开");
      };
    }
  }

  async function buildGraph() {
    if (!stream) throw new Error("no stream");
    ctx = new AudioCtx({ sampleRate: 16000 });
    await ctx.resume();
    rate = ctx.sampleRate;
    source = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(4096, 1, 1);
    sink = ctx.createGain();
    sink.gain.value = 0;
    processor.onaudioprocess = onAudio;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);
  }

  function teardownGraph() {
    try {
      if (processor) processor.onaudioprocess = null;
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
    processor = source = sink = null;
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
        await acquireMic();
        await buildGraph();
        reconnecting = false;
        if (!ended) cb.onPhase("listening");
        return;
      } catch {
        await delay(700 * attempt);
      }
    }
    reconnecting = false;
    if (!ended) cb.onError("麦克风重连失败，请切回打字，或重新开始通话。");
  }

  // Initial setup (errors propagate to the caller, which shows a hint).
  await acquireMic();
  await buildGraph();
  cb.onPhase("listening");

  // Keep the context alive: browsers suspend it when backgrounded / on device
  // changes, which would silently freeze the call.
  const keepAlive = setInterval(() => {
    if (ended || reconnecting) return;
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => undefined);
  }, KEEPALIVE_MS);

  return {
    end: () => {
      ended = true;
      clearInterval(keepAlive);
      teardownGraph();
    },
  };
}
