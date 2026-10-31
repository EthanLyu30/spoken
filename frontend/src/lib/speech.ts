/** Whole-reply speech: one native utterance or one complete audio file. */
import { fetchTtsUrl } from "./api";
import { useVoice, VOICE_OPTIONS } from "../store/voice";
import { beginSpeechPlayback, type SpeechPlayback } from "../store/speechPlayback";
import { autoCloudOverrides, resolveVoiceMode } from "./voiceResolver";
import { float32ToWavBlob } from "./localSpeech/audio";
import { isLocalSpeechModelReady, localSpeechCoordinator } from "./localSpeech/runtime";
import { bindInteraction, reportTiming } from "./telemetry";

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
function speakBrowser(text: string, settings: VoiceSettings, onStarted: () => void): Speaking {
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickBrowserVoice(settings.browserVoiceURI);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? "en-US";
  utterance.rate = 0.7 + ((settings.speed ?? 50) / 100) * 0.8;
  utterance.pitch = 0.6 + ((settings.pitch ?? 50) / 100) * 0.9;
  let failed = false, finished = false, started = false;
  let startupTimer = 0, completionTimer = 0;
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
  const fail = () => {
    if (finished) return;
    failed = true; cancelNative();
  };
  utterance.onstart = () => {
    if (finished || started) return;
    started = true;
    window.clearTimeout(startupTimer);
    // Generous text/rate allowance; an incomplete utterance fails without replay.
    completionTimer = window.setTimeout(fail, Math.max(60_000, text.length * 150 / utterance.rate));
    onStarted();
  };
  utterance.onend = () => { if (!finished) { failed = !started; finish(); } };
  utterance.onerror = fail;
  startupTimer = window.setTimeout(fail, 5_000);
  try { synth.cancel(); synth.speak(utterance); }
  catch { fail(); }
  return { done, get failed() { return failed; }, stop: () => { if (!finished) cancelNative(); } };
}
function playUrl(url: string, onStarted: () => void): Speaking {
  const audio = new Audio(url);
  let failed = false, finished = false;
  let settle: () => void = () => {};
  const done = new Promise<void>(resolve => { settle = resolve; });
  const cleanup = () => {
    if (finished) return;
    finished = true;
    audio.onplaying = audio.onended = audio.onerror = null;
    URL.revokeObjectURL(url);
    settle();
  };
  audio.onplaying = onStarted;
  audio.onended = cleanup;
  audio.onerror = () => { failed = true; cleanup(); };
  try { void audio.play().catch(() => { failed = true; cleanup(); }); }
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

export function createSpeechQueue(scenarioId?: string, interactionId?: string): SpeechQueue {
  current?.stop();
  const requestedAt = performance.now();
  const settings = useVoice.getState();
  const playback = beginSpeechPlayback(settings.engine);
  const cloudVoiceName = (vcn?: string | null) =>
    VOICE_OPTIONS.find(v => v.id === vcn)?.label.split(" · ")[0] ?? "场景音色";
  let buffered = "", noMore = false, stopped = false, settled = false, failed = false;
  let firstAt: number | undefined;
  let engine: "browser" | "xfyun" | "local" | "unknown" = "unknown";
  let transport: "buffered" | "local" | "unknown" = "unknown";
  let active: Speaking | null = null;
  const controller = new AbortController();
  bindInteraction(controller.signal, interactionId);
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
    markStarted();
  };
  const consumer = (async () => {
    let completed = false;
    try {
      const text = (await finalText).trim();
      if (stopped || !text) return;
      playback.update({phase:"preparing"});
      const mode = await resolveVoiceMode(settings.engine, voiceSource());
      if (stopped) return;
      let url: string | undefined;
      const fallbackReason = settings.engine === "local" ? "local-unavailable" : settings.engine === "browser" ? "browser-unavailable" : null;
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
      const browserMode = !url && settings.engine === "local"
        ? await resolveVoiceMode("browser",voiceSource()) : mode;
      if (stopped) { if (url) URL.revokeObjectURL(url); return; }
      if (!url && browserMode.kind === "browser") {
        engine = "browser"; transport = "unknown";
        playback.update({effectiveEngine:"browser",voice:pickBrowserVoice(settings.browserVoiceURI)?.name ?? "英文音色",
          fallbackReason:settings.engine === "local" ? "local-unavailable" : null});
        active = speakBrowser(text, settings, didStart);
        await active.done;
        // A listed voice may still be unavailable. Retry the complete reply
        // only before any native sound starts, so partial speech never repeats.
        if (!stopped && active.failed && firstAt === undefined) {
          active = null;
        }
      }
      if (!active) {
        if (!url) {
          if (stopped) return;
          engine = "xfyun"; transport = "buffered";
          const overrides = settings.engine !== "iflytek" ? autoCloudOverrides(settings) : {
            vcn:settings.vcn ?? undefined,speed:settings.speed ?? undefined,pitch:settings.pitch ?? undefined,
          };
          playback.update({effectiveEngine:"xfyun",voice:cloudVoiceName(overrides.vcn),
            fallbackReason});
          url = await fetchTtsUrl(text, scenarioId, controller.signal, overrides);
        }
        if (stopped) { URL.revokeObjectURL(url); return; }
        active = playUrl(url, didStart);
      }
      await active.done;
      failed = Boolean(active.failed) && !stopped;
      completed = !stopped;
    } catch (error) {
      failed = !stopped;
      if (!stopped) throw error;
    } finally {
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
      if (!stopped && !noMore) { noMore = true; buffered = full; provideText(full); }
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
export function speakText(text: string, scenarioId?: string): Speaking {
  const queue = createSpeechQueue(scenarioId);
  return {done: queue.end(text).catch(() => undefined), stop: queue.stop, get failed() { return queue.failed; }, get status() { return queue.status; }};
}
export function stopSpeaking(): void {
  current?.stop();
  current = null;
}
