/**
 * Unified read-aloud. Speaks via the browser's Web Speech voices (natural,
 * connected) or the iFlytek cloud cascade, per the user's voice settings.
 * Only one utterance plays at a time across the app.
 */
import { fetchTtsUrl } from "./api";
import { useVoice } from "../store/voice";

export interface Speaking {
  /** Resolves when playback finishes (or is stopped / errors). */
  done: Promise<void>;
  stop: () => void;
}

const hasSpeech = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** English Web Speech voices available in this browser. */
export function listBrowserVoices(): SpeechSynthesisVoice[] {
  if (!hasSpeech()) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang?.toLowerCase().startsWith("en"));
}

/** Browser voices load asynchronously; resolve once they're available. */
export function primeBrowserVoices(onReady?: () => void): void {
  if (!hasSpeech()) return;
  if (window.speechSynthesis.getVoices().length) {
    onReady?.();
    return;
  }
  const handler = () => {
    onReady?.();
    window.speechSynthesis.removeEventListener("voiceschanged", handler);
  };
  window.speechSynthesis.addEventListener("voiceschanged", handler);
}

function pickBrowserVoice(preferredURI: string | null): SpeechSynthesisVoice | null {
  const voices = listBrowserVoices();
  if (!voices.length) return null;
  if (preferredURI) {
    const found = voices.find((v) => v.voiceURI === preferredURI);
    if (found) return found;
  }
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/(natural|neural|online)/.test(n)) s += 100;
    if (/(aria|jenny|guy|libby|sonia|michelle|ava|emma|ana)/.test(n)) s += 40;
    if (v.lang.toLowerCase() === "en-us") s += 10;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

function speakBrowser(text: string): Speaking {
  const synth = window.speechSynthesis;
  synth.cancel();
  const { speed, pitch, browserVoiceURI } = useVoice.getState();
  const u = new SpeechSynthesisUtterance(text);
  const voice = pickBrowserVoice(browserVoiceURI);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = "en-US";
  }
  u.rate = 0.7 + ((speed ?? 50) / 100) * 0.8; // ~0.7 .. 1.38
  u.pitch = 0.6 + ((pitch ?? 50) / 100) * 0.9; // ~0.6 .. 1.5
  let settle: () => void = () => {};
  const done = new Promise<void>((r) => (settle = r));
  u.onend = () => settle();
  u.onerror = () => settle();
  synth.speak(u);
  return { done, stop: () => synth.cancel() };
}

function speakIflytek(text: string, scenarioId?: string): Speaking {
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  let stopped = false;
  let settle: () => void = () => {};
  const done = new Promise<void>((r) => (settle = r));
  const cleanup = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
    settle();
  };
  fetchTtsUrl(text, scenarioId)
    .then((u) => {
      if (stopped) {
        URL.revokeObjectURL(u);
        settle();
        return;
      }
      url = u;
      audio = new Audio(u);
      audio.onended = cleanup;
      audio.onerror = cleanup;
      void audio.play().catch(cleanup);
    })
    .catch(() => settle());
  return {
    done,
    stop: () => {
      stopped = true;
      audio?.pause();
      cleanup();
    },
  };
}

let current: Speaking | null = null;

/** Speak a line; stops whatever was playing. */
export function speakText(text: string, scenarioId?: string): Speaking {
  current?.stop();
  const engine = useVoice.getState().engine;
  const s = engine === "browser" && hasSpeech() ? speakBrowser(text) : speakIflytek(text, scenarioId);
  current = s;
  return s;
}

export function stopSpeaking(): void {
  current?.stop();
  current = null;
}
