/**
 * Hands-free "call mode": keep the mic open, detect end-of-utterance with a
 * simple energy-based VAD, then transcribe -> respond -> speak -> resume.
 * Turn-based (not full-duplex): the mic is ignored while Pip thinks/speaks.
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

export async function startVoiceCall(cb: CallCallbacks): Promise<VoiceCall> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const Ctx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  await ctx.resume();
  const rate = ctx.sampleRate;

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;

  let ended = false;
  let busy = false; // ignore mic while thinking / speaking
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
      const text = (await cb.transcribe(pcm)).trim();
      if (text) {
        const reply = await cb.respond(text);
        if (!ended) {
          cb.onPhase("speaking");
          await cb.speak(reply);
        }
      }
    } catch {
      if (!ended) cb.onError("通话出错了，请重试，或切回打字。");
    } finally {
      busy = false;
      if (!ended) cb.onPhase("listening");
    }
  };

  processor.onaudioprocess = (e) => {
    if (ended || busy) return;
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
      reset(); // keep the buffer small during silence
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

  source.connect(processor);
  processor.connect(sink);
  sink.connect(ctx.destination);
  cb.onPhase("listening");

  return {
    end: () => {
      ended = true;
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
        source.disconnect();
        sink.disconnect();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}
