/** Whole-reply speech: one native utterance or one complete audio file. */
import { fetchTtsUrl } from "./api";
import { useVoice } from "../store/voice";
import { autoCloudOverrides, resolveVoiceMode } from "./voiceResolver";
import { float32ToWavBlob } from "./localSpeech/audio";
import { isLocalSpeechModelReady } from "./localSpeech/runtime";
import { bindInteraction, reportTiming } from "./telemetry";

export interface Speaking {
  readonly failed?: boolean;
  done: Promise<void>;
  stop: () => void;
}
export interface SpeechQueue {
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
export function primeBrowserVoices(onReady?: () => void): void {
  if (!hasSpeech()) return;
  if (listBrowserVoices().length) { onReady?.(); return; }
  const handler = () => { onReady?.(); window.speechSynthesis.removeEventListener("voiceschanged", handler); };
  window.speechSynthesis.addEventListener("voiceschanged", handler);
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
    (voice.localService ? 100 : 0) +
    (/(natural|neural)/i.test(voice.name) ? 20 : 0) +
    (voice.lang.toLowerCase() === "en-us" ? 10 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}
function speakBrowser(text: string, settings: VoiceSettings, onStarted: () => void): Speaking {
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickBrowserVoice(settings.browserVoiceURI);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? "en-US";
  utterance.rate = 0.7 + ((settings.speed ?? 50) / 100) * 0.8;
  utterance.pitch = 0.6 + ((settings.pitch ?? 50) / 100) * 0.9;
  let failed = false, finished = false, started = false;
  let settle: () => void = () => {};
  const done = new Promise<void>(resolve => { settle = resolve; });
  const finish = () => {
    if (finished) return;
    finished = true;
    utterance.onstart = utterance.onend = utterance.onerror = null;
    settle();
  };
  utterance.onstart = () => { started = true; onStarted(); };
  utterance.onend = () => { failed = !started; finish(); };
  utterance.onerror = () => { failed = true; finish(); };
  try { synth.speak(utterance); }
  catch { failed = true; finish(); }
  return { done, get failed() { return failed; }, stop: () => {
    if (finished) return;
    try { synth.cancel(); } finally { finish(); }
  } };
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
    reportTiming("speech.first_audio", firstAt - requestedAt, {engine, transport, interactionId});
    markStarted();
  };
  const consumer = (async () => {
    let completed = false;
    try {
      const text = (await finalText).trim();
      if (stopped || !text) return;
      const mode = await resolveVoiceMode(settings.engine, voiceSource());
      if (stopped) return;
      if (mode.kind === "browser") {
        engine = "browser";
        active = speakBrowser(text, settings, didStart);
        await active.done;
        // A listed voice may still be unavailable. Retry the complete reply
        // only before any native sound starts, so partial speech never repeats.
        if (!stopped && active.failed && firstAt === undefined) {
          engine = "xfyun"; transport = "buffered";
          const url = await fetchTtsUrl(text, scenarioId, controller.signal, autoCloudOverrides(settings));
          if (stopped) { URL.revokeObjectURL(url); return; }
          active = playUrl(url, didStart);
        }
      } else {
        let url: string | undefined;
        if (settings.engine === "local" && isLocalSpeechModelReady("kokoro")) {
          try { engine = "local"; transport = "local"; url = await fetchKokoroUrl(text, settings.speed); }
          catch { if (stopped) return; }
        }
        if (!url) {
          if (stopped) return;
          engine = "xfyun"; transport = "buffered";
          url = await fetchTtsUrl(text, scenarioId, controller.signal,
            mode.automaticFallback ? autoCloudOverrides(settings) : undefined);
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
      try { active?.stop(); } catch { /* cancellation must always settle */ }
      provideText(""); cancel();
    },
  };
  current = {done: consumer.catch(() => undefined), stop: queue.stop};
  return queue;
}
export function speakText(text: string, scenarioId?: string): Speaking {
  const queue = createSpeechQueue(scenarioId);
  return {done: queue.end(text).catch(() => undefined), stop: queue.stop, get failed() { return queue.failed; }};
}
export function stopSpeaking(): void {
  current?.stop();
  current = null;
}
