/** Whole-reply speech: one native utterance or one complete audio file. */
import { useVoice } from "../store/voice";
import { beginSpeechPlayback, type SpeechPlayback } from "../store/speechPlayback";
import { resolveVoiceMode } from "./voiceResolver";
import { float32ToWavBlob } from "./localSpeech/audio";
import { isLocalSpeechModelReady, localSpeechCoordinator } from "./localSpeech/runtime";
import { bindInteraction, reportTiming, NATIVE_ERRORS, type NativeDiagnostic, type NativeEndDiagnostic } from "./telemetry";

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
  /** Explicitly opt in to starting the first complete browser sentence early. */
  startEarly?: () => void;
  end: (full: string) => Promise<void>;
  started: Promise<void>;
  stop: () => void;
  readonly failed?: boolean;
}

function firstCompleteSentence(text: string): string | null {
  // Require a likely sentence boundary (uppercase/quote/end) so abbreviations,
  // decimals and "e.g." do not get spoken as a standalone first utterance.
  const match = text.match(/^[\s\S]*?[.!?](?=\s+["“'A-Z]|\s*$)/);
  if (!match) return null;
  const sentence = match[0].trim();
  if (sentence.length < 3) return null;
  const lastWord = sentence.slice(0, -1).trim().split(/\s+/).at(-1)?.replace(/[^A-Za-z.]/g, "") ?? "";
  if (/^(mr|mrs|ms|dr|prof|sr|jr|st|vs|e\.g|i\.e)\.?$/i.test(lastWord)) return null;
  return sentence;
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
function speakBrowser(text: string, settings: VoiceSettings, voice: SpeechSynthesisVoice, onStarted: () => void, onOutcome: (duration: number, diagnostic: NativeDiagnostic, outcome: "ok" | "error" | "cancelled") => void, onTerminal: (duration: number, diagnostic: NativeEndDiagnostic, outcome: "ok" | "error" | "cancelled") => void): Speaking {
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 0.7 + ((settings.speed ?? 50) / 100) * 0.8;
  utterance.pitch = 0.6 + ((settings.pitch ?? 50) / 100) * 0.9;
  let failed = false, finished = false, started = false;
  let startupTimer = 0, completionTimer = 0;
  const attemptStartedAt = performance.now();
  const completionBudget = Math.max(60_000, text.length * 150 / utterance.rate);
  let nativeRequestedAt: number | undefined;
  let pauseCount = 0, resumeCount = 0, pausedDurationMs = 0, recoveryAttempted = false;
  let pausedSince: number | undefined;
  const state = () => [synth.paused, synth.speaking, synth.pending].every(value => typeof value === "boolean")
    ? Number(synth.paused) | (Number(synth.speaking) << 1) | (Number(synth.pending) << 2) : undefined;
  const currentlyPaused = () => synth.paused;
  const visibility = (): NativeEndDiagnostic["visibility_state"] => {
    if (typeof document === "undefined") return "unknown";
    return document.visibilityState === "visible" || document.visibilityState === "hidden" ? document.visibilityState : "unknown";
  };
  const stateBefore = state();
  let startReported = false, terminalReported = false;
  const reportStart = (reason: NativeDiagnostic["reason"], error?: string, stateAfter = state()) => {
    if (startReported) return;
    startReported = true;
    onOutcome(performance.now() - (nativeRequestedAt ?? attemptStartedAt), {
      reason, state_before: stateBefore, state_after: stateAfter,
      voice_type: !voice ? "unknown" : /(natural|neural|google|enhanced|premium)/i.test(voice.name) ? "enhanced" : voice.localService === false ? "remote" : voice.localService === true ? "local" : "unknown",
      ...(settings.browserVoiceURI ? {voice_matched: voice?.voiceURI === settings.browserVoiceURI} : {}),
      ...(error !== undefined ? {error_code: NATIVE_ERRORS.find(code => code === error) ?? "unknown"} : {}),
    }, reason === "started" ? "ok" : reason === "cancelled" ? "cancelled" : "error");
  };
  const pausedDuration = (now: number) => Math.min(300_000, pausedDurationMs + (pausedSince === undefined ? 0 : Math.max(0, now - pausedSince)));
  const reportTerminal = (reason: NonNullable<NativeEndDiagnostic["reason"]>, error: string | undefined, stateAtEvent: number | undefined) => {
    if (terminalReported || !started) return;
    terminalReported = true;
    const now = performance.now();
    onTerminal(now - (nativeRequestedAt ?? attemptStartedAt), {
      reason,
      ...(stateAtEvent !== undefined ? {state_at_event: stateAtEvent} : {}),
      watchdog_budget_ms: Math.min(3_600_000, completionBudget),
      pause_count: pauseCount, resume_count: resumeCount,
      paused_duration_ms: pausedDuration(now), visibility_state: visibility(),
      ...(error !== undefined ? {error_code: NATIVE_ERRORS.find(code => code === error) ?? "unknown"} : {}),
    }, reason === "end" ? "ok" : reason === "cancelled" ? "cancelled" : "error");
  };
  let settle: () => void = () => {};
  const done = new Promise<void>(resolve => { settle = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(startupTimer);
    window.clearTimeout(completionTimer);
    utterance.onstart = utterance.onend = utterance.onerror = utterance.onpause = utterance.onresume = null;
    settle();
  };
  const cancelNative = () => {
    finish(); // Detach handlers before cancel can synchronously emit callbacks.
    try { synth.cancel(); } catch { /* the task must still settle */ }
  };
  const failStartup = (reason: NativeDiagnostic["reason"], error?: string) => {
    if (finished) return;
    failed = true;
    const stateAtEvent = state();
    cancelNative();
    reportStart(reason, error, stateAtEvent);
  };
  const failTerminal = (reason: "native_error" | "completion_timeout", error?: string) => {
    if (finished) return;
    failed = true;
    const stateAtEvent = state(); // Cancel can synchronously clear native state.
    cancelNative();
    reportTerminal(reason, error, stateAtEvent);
  };
  const markPaused = () => {
    if (finished || !started || pausedSince !== undefined) return;
    pausedSince = performance.now();
    pauseCount = Math.min(100, pauseCount + 1);
  };
  const markResumed = () => {
    if (finished || !started || pausedSince === undefined) return;
    const now = performance.now();
    pausedDurationMs += Math.max(0, now - pausedSince);
    pausedSince = undefined;
    if (resumeCount < pauseCount) resumeCount = Math.min(100, resumeCount + 1);
  };
  const completionWatchdog = () => {
    if (finished) return;
    // A visible, paused engine gets one bounded nudge; every other state keeps
    // the original deadline. There is never a replay or periodic pause/resume.
    if (!recoveryAttempted && synth.paused === true && visibility() === "visible") {
      recoveryAttempted = true;
      markPaused();
      if (typeof synth.resume === "function") {
        resumeCount = Math.min(100, resumeCount + 1);
        try {
          synth.resume();
          if (currentlyPaused() === false) markResumed();
        } catch { /* grace still bounds a failed resume */ }
      }
      completionTimer = window.setTimeout(() => failTerminal("completion_timeout"), 2_000);
      return;
    }
    failTerminal("completion_timeout");
  };
  utterance.onstart = () => {
    if (finished || started) return;
    started = true;
    window.clearTimeout(startupTimer);
    if (synth.paused === true) markPaused();
    completionTimer = window.setTimeout(completionWatchdog, completionBudget);
    reportStart("started");
    onStarted();
  };
  utterance.onpause = markPaused;
  utterance.onresume = markResumed;
  utterance.onend = () => {
    if (finished) return;
    if (!started) { failStartup("end_before_start"); return; }
    const stateAtEvent = state();
    finish();
    reportTerminal("end", undefined, stateAtEvent);
  };
  utterance.onerror = event => {
    if (started) failTerminal("native_error", event?.error ?? "unknown");
    else failStartup("speech_error", event?.error ?? "unknown");
  };
  startupTimer = window.setTimeout(() => failStartup("startup_timeout"), 5_000);
  try {
    // Older engines may not expose state; keep their defensive cancellation.
    if (synth.speaking !== false || synth.pending !== false) synth.cancel();
    // W3C cancel does not reset paused. Recover only a genuinely paused engine.
    if (synth.paused === true && typeof synth.resume === "function") synth.resume();
    nativeRequestedAt = performance.now();
    synth.speak(utterance);
  } catch { failStartup("speak_exception", "unknown"); }
  return { done, get failed() { return failed; }, stop: () => {
    if (finished) return;
    const stateAtEvent = state(); // Sample before cancel, including native pending/speaking bits.
    cancelNative();
    if (started) reportTerminal("cancelled", undefined, stateAtEvent);
    else reportStart("cancelled", undefined, stateAtEvent);
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
  let earlyEnabled = false, earlyText = "";
  let releaseEarly: () => void = () => {};
  const earlyReady = new Promise<void>(resolve => { releaseEarly = resolve; });
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
    if (finalTextAt !== undefined && firstAt >= finalTextAt) reportTiming("speech.final_text_to_audio", firstAt - finalTextAt, {engine, transport, interactionId});
    markStarted();
  };
  const reportNativeStart = (duration: number, diagnostic: NativeDiagnostic, outcome: "ok" | "error" | "cancelled") => {
    reportTiming("speech.native_start", duration, {engine: "browser", transport: "unknown", interactionId, outcome, ...diagnostic});
  };
  const reportNativeEnd = (duration: number, diagnostic: NativeEndDiagnostic, outcome: "ok" | "error" | "cancelled") => {
    reportTiming("speech.native_end", duration, {engine: "browser", transport: "unknown", interactionId, outcome, ...diagnostic});
  };
  const consumer = (async () => {
    let completed = false;
    try {
      await earlyReady;
      if (stopped) return;
      const early = earlyText.trim();
      if (early) {
        // The first complete sentence can start while the model is still
        // streaming. Resolve the browser voice before speaking it, then speak
        // only the remaining text once the final reply arrives.
        const resolutionStart = performance.now();
        let browserMode = await preparedMode;
        if (!stopped && browserMode) {
          if (listBrowserVoices().length > 0) browserMode = {kind:"browser"};
          else if (browserMode.kind === "browser") {
            browserMode = await resolveVoiceMode("browser", voiceSource(), controller.signal);
          }
        }
        if (!stopped) reportTiming("speech.voice_resolution", performance.now() - resolutionStart, {
          engine: browserMode?.kind === "browser" ? "browser" : "unknown", transport: "unknown", interactionId,
        });
        const browserVoice = !stopped && browserMode?.kind === "browser" ? pickBrowserVoice(settings.browserVoiceURI) : null;
        if (browserVoice) {
          preparation?.dispose();
          engine = "browser"; transport = "unknown";
          playback.update({effectiveEngine:"browser",voice:browserVoice.name,
            fallbackReason:settings.engine === "local" ? "local-unavailable" : null});
          active = speakBrowser(early, settings, browserVoice, didStart, reportNativeStart, reportNativeEnd);
          await active.done;
          if (stopped) return;
          if (active.failed) {
            failed = true;
            playback.update({fallbackReason:"browser-start-failed"});
            return;
          }
          const final = (await finalText).trim();
          const remainder = final.startsWith(early) ? final.slice(early.length).trim() : final.trim();
          if (remainder && !stopped) {
            active = speakBrowser(remainder, settings, browserVoice, didStart, reportNativeStart, reportNativeEnd);
            await active.done;
            failed = Boolean(active.failed) && !stopped;
            if (failed) playback.update({fallbackReason:"browser-start-failed"});
          }
          completed = !stopped && !failed;
          return;
        }
        // No browser voice: fall through and use the normal whole-reply path.
      }
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
        active = speakBrowser(text, settings, browserVoice, didStart, reportNativeStart, reportNativeEnd);
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
  const armEarly = () => {
    if (!earlyEnabled || earlyText || stopped || noMore) return;
    const sentence = firstCompleteSentence(buffered);
    if (sentence) {
      earlyText = sentence;
      releaseEarly();
    }
  };
  const queue: SpeechQueue = {
    get status() { return playback.status; },
    feed: full => {
      if (stopped || noMore) return;
      buffered = full;
      armEarly();
    },
    startEarly: () => {
      if (earlyEnabled || stopped || noMore || settled || settings.engine !== "browser") return;
      earlyEnabled = true;
      armEarly();
    },
    end: full => {
      if (!stopped && !noMore) { noMore = true; buffered = full; finalTextAt = performance.now(); provideText(full); }
      releaseEarly();
      return done;
    },
    started,
    get failed() { return failed; },
    stop: () => {
      if (stopped || settled) return;
      stopped = true; controller.abort();
      playback.update({phase:"cancelled"});
      releaseEarly();
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
