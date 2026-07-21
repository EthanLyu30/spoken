/**
 * Unified read-aloud. Speaks via the browser's Web Speech voices (natural,
 * connected) or the iFlytek cloud cascade, per the user's voice settings.
 * Only one utterance plays at a time across the app.
 */
import { fetchTtsUrl, type TtsOverrides } from "./api";
import { nextSentences } from "./sentences";
import { useVoice } from "../store/voice";
import {
  autoCloudOverrides,
  resolveVoiceMode,
} from "./voiceResolver";
import { float32ToWavBlob } from "./localSpeech/audio";
import { isLocalSpeechModelReady } from "./localSpeech/runtime";

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

function voiceSource() {
  return {
    listEnglishVoices: listBrowserVoices,
    subscribe: (callback: () => void) => {
      if (!hasSpeech()) return () => undefined;
      window.speechSynthesis.addEventListener("voiceschanged", callback);
      return () =>
        window.speechSynthesis.removeEventListener(
          "voiceschanged",
          callback,
        );
    },
    timeoutMs: 500,
  };
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

function speakIflytek(
  text: string,
  scenarioId?: string,
  overrides?: TtsOverrides,
): Speaking {
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
  fetchTtsUrl(text, scenarioId, undefined, overrides)
    .then((nextUrl) => {
      if (stopped) {
        URL.revokeObjectURL(nextUrl);
        settle();
        return;
      }
      url = nextUrl;
      audio = new Audio(nextUrl);
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

function kokoroSpeed(speed: number | null): number {
  return 0.8 + ((speed ?? 50) / 100) * 0.4;
}

async function fetchKokoroUrl(text: string): Promise<string> {
  const { speed } = useVoice.getState();
  const { synthesizeWithKokoro } = await import("./localSpeech/kokoro");
  const output = await synthesizeWithKokoro(text, kokoroSpeed(speed));
  return URL.createObjectURL(
    float32ToWavBlob(output.audio, output.sampleRate),
  );
}

function speakResolved(text: string, scenarioId?: string): Speaking {
  let active: Speaking | null = null;
  let stopped = false;
  const done = (async () => {
    const voice = useVoice.getState();
    const mode = await resolveVoiceMode(voice.engine, voiceSource());
    if (stopped) return;
    if (mode.kind === "browser") {
      active = speakBrowser(text);
    } else if (
      mode.automaticFallback &&
      isLocalSpeechModelReady("kokoro")
    ) {
      try {
        const url = await fetchKokoroUrl(text);
        if (stopped) {
          URL.revokeObjectURL(url);
          return;
        }
        active = playUrl(url);
      } catch {
        active = speakIflytek(
          text,
          scenarioId,
          autoCloudOverrides(voice),
        );
      }
    } else {
      active = speakIflytek(
        text,
        scenarioId,
        mode.automaticFallback ? autoCloudOverrides(voice) : undefined,
      );
    }
    await active.done;
  })();
  return {
    done,
    stop: () => {
      stopped = true;
      active?.stop();
    },
  };
}

let current: Speaking | null = null;

/** Speak a line; stops whatever was playing. */
export function speakText(text: string, scenarioId?: string): Speaking {
  current?.stop();
  const s = speakResolved(text, scenarioId);
  current = s;
  return s;
}

export function stopSpeaking(): void {
  current?.stop();
  current = null;
}

/** Play an already-fetched object URL; resolves when it ends, errors, or stops. */
function playUrl(url: string): Speaking {
  const audio = new Audio(url);
  let settle: () => void = () => {};
  const done = new Promise<void>((r) => (settle = r));
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    URL.revokeObjectURL(url);
    settle();
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;
  void audio.play().catch(cleanup);
  return {
    done,
    stop: () => {
      audio.pause();
      cleanup();
    },
  };
}

export interface SpeechQueue {
  /** Feed the cumulative reply text so far; speaks any newly-complete sentence. */
  feed: (full: string) => void;
  /** Final cumulative text; speaks the remaining tail, then resolves when all audio has played. */
  end: (full: string) => Promise<void>;
  /** Resolves the first time a sentence is about to be spoken. */
  started: Promise<void>;
  /** Stop immediately and drop anything still queued. */
  stop: () => void;
}

/**
 * Speak a reply sentence-by-sentence, in order, as it streams in. The first
 * sentence can start playing while later ones are still being generated — this
 * is what makes call mode feel responsive instead of waiting for the whole
 * reply to be generated and synthesised. For the iFlytek engine the next
 * sentence's audio is prefetched while the current one plays, to keep the gap
 * between sentences small.
 */
export function createSpeechQueue(scenarioId?: string): SpeechQueue {
  current?.stop();
  current = null;
  const voiceAtStart = useVoice.getState();
  const modePromise = resolveVoiceMode(
    voiceAtStart.engine,
    voiceSource(),
  );

  const pending: string[] = [];
  let spokenUpto = 0;
  let noMore = false;
  let stopped = false;
  let wake: (() => void) | null = null;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((r) => {
    markStarted = () => r();
  });
  let playing: Speaking | null = null;

  const wakeUp = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  // Resolve with the next chunk to speak, or null when the queue is done.
  const take = (): Promise<string | null> =>
    new Promise((resolve) => {
      const check = () => {
        if (stopped) return resolve(null);
        if (pending.length) return resolve(pending.shift() as string);
        if (noMore) return resolve(null);
        wake = check;
      };
      check();
    });

  const consumer = (async () => {
    const mode = await modePromise;
    const overrides =
      mode.kind === "iflytek" && mode.automaticFallback
        ? autoCloudOverrides(voiceAtStart)
        : undefined;
    let prefetchText: string | null = null;
    let prefetchUrl: Promise<string> | null = null;
    let firstStarted = false;
    const abandonPrefetch = () => {
      const abandoned = prefetchUrl;
      prefetchText = null;
      prefetchUrl = null;
      if (abandoned) {
        void abandoned.then((url) => {
          if (url) URL.revokeObjectURL(url);
        });
      }
    };
    try {
      while (!stopped) {
        const text = await take();
        if (text == null) break;
        if (!firstStarted) {
          firstStarted = true;
          markStarted?.();
        }

        if (mode.kind === "browser") {
          playing = speakBrowser(text);
          await playing.done;
          continue;
        }

        // Automatic fallback is re-evaluated at every sentence boundary. If
        // Kokoro became ready while the previous sentence played, discard any
        // speculative cloud audio and switch without interrupting playback.
        if (
          mode.automaticFallback &&
          isLocalSpeechModelReady("kokoro")
        ) {
          abandonPrefetch();
          let localUrl: string;
          try {
            localUrl = await fetchKokoroUrl(text);
          } catch {
            try {
              localUrl = await fetchTtsUrl(
                text,
                scenarioId,
                undefined,
                overrides,
              );
            } catch {
              continue;
            }
          }
          if (stopped) {
            URL.revokeObjectURL(localUrl);
            break;
          }
          playing = playUrl(localUrl);
          await playing.done;
          continue;
        }

        let url: string;
        try {
          url =
            prefetchText === text && prefetchUrl
              ? await prefetchUrl
              : await fetchTtsUrl(
                  text,
                  scenarioId,
                  undefined,
                  overrides,
                );
        } catch {
          prefetchText = null;
          prefetchUrl = null;
          continue; // skip a sentence we couldn't synthesise; keep going
        }
        // Prefetch the next queued sentence while this one plays.
        prefetchText = pending[0] ?? null;
        prefetchUrl = prefetchText
          ? fetchTtsUrl(
              prefetchText,
              scenarioId,
              undefined,
              overrides,
            ).catch(() => "")
          : null;
        if (stopped || !url) {
          if (url) URL.revokeObjectURL(url);
          if (stopped) break;
          continue;
        }
        playing = playUrl(url);
        await playing.done;
      }
    } finally {
      abandonPrefetch();
    }
  })();

  return {
    feed: (full: string) => {
      if (stopped || noMore) return;
      const { sentences, consumed } = nextSentences(full, spokenUpto, false);
      spokenUpto = consumed;
      if (sentences.length) {
        pending.push(...sentences);
        wakeUp();
      }
    },
    end: async (full: string) => {
      if (!stopped) {
        const { sentences, consumed } = nextSentences(full, spokenUpto, true);
        spokenUpto = consumed;
        pending.push(...sentences);
      }
      noMore = true;
      wakeUp();
      await consumer;
    },
    started,
    stop: () => {
      stopped = true;
      playing?.stop();
      wakeUp();
    },
  };
}
