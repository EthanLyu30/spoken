/** Whole-reply speech: one native utterance or one complete audio file. */
import { useVoice } from "../store/voice";
import { beginSpeechPlayback, type SpeechPlayback } from "../store/speechPlayback";
import { resolveVoiceMode } from "./voiceResolver";
import { float32ToWavBlob } from "./localSpeech/audio";
import { isLocalSpeechModelReady, localSpeechCoordinator } from "./localSpeech/runtime";
import { bindInteraction, reportTiming, NATIVE_ERRORS, type NativeDiagnostic } from "./telemetry";

export interface Speaking {
  readonly status?: SpeechPlayback;
  readonly failed?: boolean;
  done: Promise<void>;
  stop: () => void;
}
export interface SpeechQueue {
  readonly status?: SpeechPlayback;
  /** Cache cumulative text; audio starts only when end supplies final text. */
  feed: (full: string) => void;
  end: (full: string) => Promise<void>;
  started: Promise<void>;
  stop: () => void;
  readonly failed?: boolean;
}
type VoiceSettings = ReturnType<typeof useVoice.getState>;
const hasSpeech = () => typeof window !== "undefined" &&
  typeof window.speechSynthesis?.getVoices === "function" &&
  typeof SpeechSynthesisUtterance === "function";

export function listBrowserVoices(): SpeechSynthesisVoice[] {
  if (!hasSpeech()) return [];
  try { return window.speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith("en")); }
  catch { return []; }
}
export function primeBrowserVoices(onReady?: () => void): () => void {
  if (!hasSpeech()) { onReady?.(); return () => {}; }
  const synth = window.speechSynthesis;
  const handler = () => onReady?.();
  // Online/Natural voices can arrive after the initial system voice list.
  synth.addEventListener("voiceschanged", handler);
  handler();
  return () => synth.removeEventListener("voiceschanged", handler);
}
function voiceSource() {
  return {
    listEnglishVoices: listBrowserVoices,
    subscribe: (callback: () => void) => {
      if (!hasSpeech()) return () => undefined;
      window.speechSynthesis.addEventListener("voiceschanged", callback);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", callback);
    },
    timeoutMs: 500,
  };
}
function pickBrowserVoice(uri: string | null): SpeechSynthesisVoice | null {
  const voices = listBrowserVoices();
  const selected = uri ? voices.find(v => v.voiceURI === uri) : undefined;
  if (selected) return selected;
  const score = (voice: SpeechSynthesisVoice) =>
    (/(natural|neural|google|enhanced|premium)/i.test(voice.name) ? 100 : 0) +
    (voice.lang.toLowerCase() === "en-us" ? 10 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}
function speakBrowser(text: string, settings: VoiceSettings, voice: SpeechSynthesisVoice, onStarted: () => void, onOutcome: (duration: number, diagnostic: NativeDiagnostic, outcome: "ok" | "error" | "cancelled") => void): Speaking {
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 0.7 + ((settings.speed ?? 50) / 100) * 0.8;
  utterance.pitch = 0.6 + ((settings.pitch ?? 50) / 100) * 0.9;
  let failed = false, finished = false, started = false;
  let startupTimer = 0, completionTimer = 0;
  const attemptStartedAt = performance.now();
  let nativeRequestedAt: number | undefined;
  const state = () => [synth.paused, synth.speaking, synth.pending].every(value => typeof value === "boolean")
    ? Number(synth.paused) | (Number(synth.speaking) << 1) | (Number(synth.pending) << 2) : undefined;
  const stateBefore = state();
  let reported = false;
  const report = (reason: NativeDiagnostic["reason"], error?: string) => {
    if (reported) return;
    reported = true;
    onOutcome(performance.now() - (nativeRequestedAt ?? attemptStartedAt), {
      reason, state_before: stateBefore, state_after: state(),
      voice_type: !voice ? "unknown" : /(natural|neural|google|enhanced|premium)/i.test(voice.name) ? "enhanced" : voice.localService === false ? "remote" : voice.localService === true ? "local" : "unknown",
      ...(settings.browserVoiceURI ? {voice_matched: voice?.voiceURI === settings.browserVoiceURI} : {}),
      ...(error !== undefined ? {error_code: NATIVE_ERRORS.find(code => code === error) ?? "unknown"} : {}),
    }, reason === "started" ? "ok" : reason === "cancelled" ? "cancelled" : "error");
  };
  let settle: () => void = () => {};
  const done = new Promise<void>(resolve => { settle = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(startupTimer);
    window.clearTimeout(completionTimer);
    utterance.onstart = utterance.onend = utterance.onerror = null;
    settle();
  };
  const cancelNative = () => {
    finish(); // Detach handlers before cancel can synchronously emit callbacks.
    try { synth.cancel(); } catch { /* the task must still settle */ }
  };
  const fail = (reason: NativeDiagnostic["reason"], error?: string) => {
    if (finished) return;
    failed = true;
    cancelNative();
    report(reason, error);
  };
  utterance.onstart = () => {
    if (finished || started) return;
    started = true;
    window.clearTimeout(startupTimer);
    // Generous text/rate allowance; an incomplete utterance fails without replay.
    completionTimer = window.setTimeout(() => fail("speech_error"), Math.max(60_000, text.length * 150 / utterance.rate));
    report("started");
    onStarted();
  };
  utterance.onend = () => { if (!finished) { failed = !started; finish(); report("end_before_start"); } };
  utterance.onerror = event => fail("speech_error", event?.error ?? "unknown");
  startupTimer = window.setTimeout(() => fail("startup_timeout"), 5_000);
  try {
    // Older engines may not expose state; keep their defensive cancellation.
    if (synth.speaking !== false || synth.pending !== false) synth.cancel();
    // W3C cancel does not reset paused. Recover only a genuinely paused engine.
    if (synth.paused === true && typeof synth.resume === "function") synth.resume();
    nativeRequestedAt = performance.now();
    synth.speak(utterance);
  } catch { fail("speak_exception", "unknown"); }
  return { done, get failed() { return failed; }, stop: () => {
    if (!finished) { cancelNative(); report("cancelled"); }
  } };
}
function playUrl(url: string, onStarted: (durationMs: number) => void): Speaking {
  const audio = new Audio(url);
  let failed = false, finished = false, started = false;
  let playRequestedAt = 0;
  let settle: () => void = () => {};
  const done = new Promise<void>(resolve => { settle = resolve; });
  const cleanup = () => {
    if (finished) return;
    finished = true;
    audio.onplaying = audio.onended = audio.onerror = null;
    URL.revokeObjectURL(url);
    settle();
  };
  audio.onplaying = () => {
    if (finished || started) return;
    started = true;
    onStarted(performance.now() - playRequestedAt);
  };
  audio.onended = cleanup;
  audio.onerror = () => { failed = true; cleanup(); };
  try { playRequestedAt = performance.now(); void audio.play().catch(() => { failed = true; cleanup(); }); }
  catch { failed = true; cleanup(); }
  return { done, get failed() { return failed; }, stop: () => {
    if (finished) return;
    try { audio.pause(); } finally { cleanup(); }
  } };
}
async function fetchKokoroUrl(text: string, speed: number | null): Promise<string> {
  const { synthesizeWithKokoro } = await import("./localSpeech/kokoro");
  const output = await synthesizeWithKokoro(text, 0.8 + ((speed ?? 50) / 100) * 0.4);
  return URL.createObjectURL(float32ToWavBlob(output.audio, output.sampleRate));
}
let current: Speaking | null = null;

export interface SpeechPreparation {
  consume: () => ReturnType<typeof resolveVoiceMode> | undefined;
  dispose: () => void;
}
/** Browser voice discovery only; never owns playback or synthesizes text. */
export function prepareSpeech(signal?: AbortSignal): SpeechPreparation {
  const controller = new AbortController();
  let consumed = false;
  const dispose = () => { controller.abort(); signal?.removeEventListener("abort", dispose); };
  if (signal?.aborted) dispose();
  else signal?.addEventListener("abort", dispose, {once: true});
  const mode = resolveVoiceMode("browser", voiceSource(), controller.signal);
  return {dispose, consume: () => {
    if (consumed || controller.signal.aborted) return undefined;
    consumed = true;
    return mode;
  }};
}
export interface SpeechContext {
  preparation?: SpeechPreparation;
  interactionId?: string;
  submittedAt?: number;
}
export function createSpeechQueue(_scenarioId?: string, interactionId?: string, context?: SpeechContext): SpeechQueue {
  current?.stop();
  const requestedAt = performance.now();
  const settings = useVoice.getState();
  const playback = beginSpeechPlayback(settings.engine);
  let buffered = "", noMore = false, stopped = false, settled = false, failed = false;
  let firstAt: number | undefined, finalTextAt: number | undefined;
  let engine: "browser" | "local" | "unknown" = "unknown";
  let transport: "local" | "unknown" = "unknown";
  let active: Speaking | null = null;
  const controller = new AbortController();
  bindInteraction(controller.signal, interactionId);
  // Discovery overlaps model generation; synthesis still requires final text.
  // Local remains opt-in and prepares the same browser fallback if unavailable.
  const preparation = context?.preparation;
  controller.signal.addEventListener("abort", () => preparation?.dispose(), {once: true});
  const preparedMode = preparation?.consume()
    ?? resolveVoiceMode("browser", voiceSource(), controller.signal);
  let provideText: (text: string) => void = () => {};
  const finalText = new Promise<string>(resolve => { provideText = resolve; });
  let markStarted: () => void = () => {};
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  let cancel: () => void = () => {};
  const cancelled = new Promise<void>(resolve => { cancel = resolve; });
  const didStart = () => {
    if (stopped || firstAt !== undefined) return;
    firstAt = performance.now();
    playback.update({phase:"speaking"});
    reportTiming("speech.first_audio", firstAt - requestedAt, {engine, transport, interactionId});
    if (context?.submittedAt !== undefined) reportTiming("speech.request_to_audio", firstAt - context.submittedAt, {engine, transport, interactionId});
    if (finalTextAt !== undefined) reportTiming("speech.final_text_to_audio", firstAt - finalTextAt, {engine, transport, interactionId});
    markStarted();
  };
  const consumer = (async () => {
    let completed = false;
    try {
      const text = (await finalText).trim();
      if (stopped || !text) return;
      playback.update({phase:"preparing"});
      let url: string | undefined;
      if (settings.engine === "local" && isLocalSpeechModelReady("kokoro")) {
        try {
          engine = "local"; transport = "local";
          playback.update({effectiveEngine:"local",voice:"Kokoro · Heart"});
          url = await fetchKokoroUrl(text, settings.speed);
        } catch (error) {
          localSpeechCoordinator.markError("kokoro",error);
          if (stopped) return;
        }
      }
      const resolutionStart = performance.now();
      // Never freeze an early empty list: English/Natural voices may arrive
      // during model/local synthesis even after the discovery timer expired.
      let browserMode = !url ? await preparedMode : null;
      if (!stopped && browserMode) {
        if (listBrowserVoices().length > 0) browserMode = {kind:"browser"};
        else if (browserMode.kind === "browser") {
          // A device can also remove its earlier list; keep the English-only
          // selection policy and the existing discovery deadline in that case.
          browserMode = await resolveVoiceMode("browser", voiceSource(), controller.signal);
        }
      }
      if (!stopped && !url) reportTiming("speech.voice_resolution", performance.now() - resolutionStart, {
        engine: browserMode?.kind === "browser" ? "browser" : "unknown", transport: "unknown", interactionId,
      });
      if (stopped) { if (url) URL.revokeObjectURL(url); return; }
      const browserVoice = !url && browserMode?.kind === "browser" ? pickBrowserVoice(settings.browserVoiceURI) : null;
      if (browserVoice) {
        preparation?.dispose();
        engine = "browser"; transport = "unknown";
        playback.update({effectiveEngine:"browser",voice:browserVoice.name,
          fallbackReason:settings.engine === "local" ? "local-unavailable" : null});
        active = speakBrowser(text, settings, browserVoice, didStart, (duration, diagnostic, outcome) => {
          reportTiming("speech.native_start", duration, {engine: "browser", transport: "unknown", interactionId, outcome, ...diagnostic});
        });
      } else if (url) {
        preparation?.dispose();
        if (stopped) { URL.revokeObjectURL(url); return; }
        active = playUrl(url, duration => {
          reportTiming("speech.play_start", duration, {engine, transport, interactionId});
          didStart();
        });
      } else {
        failed = true;
        playback.update({effectiveEngine:null,voice:null,fallbackReason:"browser-unavailable"});
        return;
      }
      await active.done;
      failed = Boolean(active.failed) && !stopped;
      if (failed && engine === "browser") playback.update({fallbackReason:"browser-start-failed"});
      completed = !stopped;
    } catch (error) {
      failed = !stopped;
      if (!stopped) throw error;
    } finally {
      controller.abort(); // Also releases unused/pending browser discovery.
      settled = true;
      playback.update({phase:stopped ? "cancelled" : failed || (buffered.trim() && firstAt === undefined) ? "error" : "completed"});
      if (buffered.trim()) {
        const finishedAt = performance.now();
        const outcome = stopped ? "cancelled" : completed && firstAt !== undefined && !failed ? "ok" : "error";
        if (firstAt !== undefined) reportTiming("speech.playback", finishedAt - firstAt, {engine, transport, interactionId, outcome});
        reportTiming("speech.complete", finishedAt - requestedAt, {engine, transport, interactionId, outcome});
      }
    }
  })();
  void consumer.catch(() => undefined);
  const done = Promise.race([consumer, cancelled]);
  void done.catch(() => undefined);
  const queue: SpeechQueue = {
    get status() { return playback.status; },
    feed: full => { if (!stopped && !noMore) buffered = full; },
    end: full => {
      if (!stopped && !noMore) { noMore = true; buffered = full; finalTextAt = performance.now(); provideText(full); }
      return done;
    },
    started,
    get failed() { return failed; },
    stop: () => {
      if (stopped || settled) return;
      stopped = true; controller.abort();
      playback.update({phase:"cancelled"});
      try { active?.stop(); } catch { /* cancellation must always settle */ }
      provideText(""); cancel();
    },
  };
  current = {done: consumer.catch(() => undefined), stop: queue.stop};
  return queue;
}
export function speakText(text: string, scenarioId?: string, context?: SpeechContext): Speaking {
  const queue = createSpeechQueue(scenarioId, context?.interactionId, context);
  return {done: queue.end(text).catch(() => undefined), stop: queue.stop, get failed() { return queue.failed; }, get status() { return queue.status; }};
}
export function stopSpeaking(): void {
  current?.stop();
  current = null;
}
