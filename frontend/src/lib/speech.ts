/**
 * Unified read-aloud. Speaks via the browser's Web Speech voices (natural,
 * connected) or the iFlytek cloud cascade, per the user's voice settings.
 * Only one utterance plays at a time across the app.
 */
import { fetchTtsStream, fetchTtsUrl, type TtsOverrides } from "./api";
import { createPcmPlayback, type PcmPlayback } from "./pcmPlayback";
import { nextSentences } from "./sentences";
import { useVoice } from "../store/voice";
import {
  autoCloudOverrides,
  resolveVoiceMode,
} from "./voiceResolver";
import { float32ToWavBlob } from "./localSpeech/audio";
import { isLocalSpeechModelReady } from "./localSpeech/runtime";
import { bindInteraction, reportTiming } from "./telemetry";

export interface Speaking {
  /** Observed playback error; cancellation keeps its existing settlement contract. */
  readonly failed?: boolean;
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

function speakBrowser(text: string, onStarted?: () => void): Speaking {
  let failed = false;
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
  u.onerror = () => { failed = true; settle(); };
  u.onstart = () => onStarted?.();
  synth.speak(u);
  return { done, get failed() { return failed; }, stop: () => { synth.cancel(); settle(); } };
}

function speakBuffered(
  text: string,
  scenarioId?: string,
  overrides?: TtsOverrides,
  onStarted?: () => void,
  interactionId?: string,
): Speaking {
  const controller = new AbortController();
  bindInteraction(controller.signal, interactionId);
  let audio: HTMLAudioElement | null = null;
  let failed = false;
  let url: string | null = null;
  let stopped = false;
  let settle: () => void = () => {};
  const done = new Promise<void>((r) => (settle = r));
  const cleanup = () => {
    if (url) URL.revokeObjectURL(url);
    url = null;
    settle();
  };
  fetchTtsUrl(text, scenarioId, controller.signal, overrides)
    .then((nextUrl) => {
      if (stopped) {
        URL.revokeObjectURL(nextUrl);
        settle();
        return;
      }
      url = nextUrl;
      audio = new Audio(nextUrl);
      audio.onended = cleanup;
      audio.onerror = () => { failed = true; cleanup(); };
      audio.onplaying = () => onStarted?.();
      void audio.play().catch(() => { failed = true; cleanup(); });
    })
    .catch(() => { failed = true; settle(); });
  return {
    done,
    get failed() { return failed; },
    stop: () => {
      stopped = true;
      controller.abort();
      audio?.pause();
      cleanup();
    },
  };
}

function canStreamAudio(): boolean {
  return typeof window.AudioContext === "function";
}

function speakIflytek(text: string, scenarioId?: string, overrides?: TtsOverrides, onStarted?: () => void, prepared?: Response, interactionId?: string): Speaking {
  if (!canStreamAudio()) return speakBuffered(text, scenarioId, overrides, onStarted, interactionId);
  const controller = new AbortController();
  bindInteraction(controller.signal, interactionId);
  let stopped = false;
  let playback: PcmPlayback | null = null;
  let fallback: Speaking | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancel: () => void = () => {};
  const cancelled = new Promise<void>((resolve) => { cancel = resolve; });
  const run = (async () => {
    const response = prepared ?? await fetchTtsStream(text, scenarioId, controller.signal, overrides);
    if (stopped) { await response.body?.cancel().catch(() => undefined); return; }
    if (response.status === 404 || response.status === 405) {
      await response.body?.cancel().catch(() => undefined);
      fallback = speakBuffered(text, scenarioId, overrides, onStarted, interactionId);
      await fallback.done;
      return;
    }
    if (!response.ok || !response.body) throw new Error("语音暂不可用，请重试。");
    const context = new AudioContext({ sampleRate: 16000 });
    playback = createPcmPlayback(context, onStarted);
    reader = response.body.getReader();
    try {
      await context.resume();
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        playback.push(value);
      }
      if (!stopped) await playback.finish();
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      playback.stop();
    }
  })();
  return {
    done: Promise.race([run, cancelled]),
    get failed() { return fallback?.failed ?? false; },
    stop: () => {
      stopped = true;
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      playback?.stop();
      fallback?.stop();
      cancel();
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
  let cancel: () => void = () => {};
  const cancelled = new Promise<void>((resolve) => { cancel = resolve; });
  const run = (async () => {
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
        if (stopped) return;
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
    done: Promise.race([run, cancelled]).catch(() => undefined),
    stop: () => {
      stopped = true;
      active?.stop();
      cancel();
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
function playUrl(url: string, onStarted?: () => void): Speaking {
  const audio = new Audio(url);
  let failed = false;
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
  audio.onerror = () => { failed = true; cleanup(); };
  audio.onplaying = () => onStarted?.();
  void audio.play().catch(() => { failed = true; cleanup(); });
  return {
    done,
    get failed() { return failed; },
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
export function createSpeechQueue(scenarioId?: string, interactionId?: string): SpeechQueue {
  const queueAt = performance.now();
  let playbackEngine: "local" | "xfyun" | "browser" | "unknown" = "unknown";
  let firstAudio = false;
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
  const controller = new AbortController();
  bindInteraction(controller.signal, interactionId);
  let cancel: () => void = () => {};
  const cancelled = new Promise<void>((resolve) => { cancel = resolve; });
  let onPending: (() => void) | null = null;
  let abortPrefetch = () => {};
  const didStart = () => {
    if (!firstAudio) {
      firstAudio = true;
      reportTiming("speech.first_audio", performance.now() - queueAt, { engine: playbackEngine, interactionId });
    }
    markStarted?.(); markStarted = undefined;
  };

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
    let prefetchLocal = false;
    let streamText: string | null = null;
    let streamResponse: Promise<Response | null> | null = null;
    let streamController: AbortController | null = null;
    const abandonStream = () => {
      const abandoned = streamResponse;
      streamController?.abort();
      streamText = null;
      streamResponse = null;
      streamController = null;
      if (abandoned) void abandoned.then((response) => response?.body?.cancel().catch(() => undefined));
    };
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
    abortPrefetch = () => { abandonPrefetch(); abandonStream(); };
    let completedNormally = false;
    let hadFailure = false;
    try {
      while (!stopped) {
        const text = await take();
        if (text == null) break;
        if (mode.kind === "browser") {
          playbackEngine = "browser";
          playing = speakBrowser(text, didStart);
          await playing.done;
          hadFailure ||= Boolean(playing.failed);
          continue;
        }

        // Automatic fallback is re-evaluated at every sentence boundary. If
        // Kokoro became ready while the previous sentence played, discard any
        // speculative cloud audio and switch without interrupting playback.
        if (
          mode.automaticFallback &&
          isLocalSpeechModelReady("kokoro")
        ) {
          abandonStream();
          if (!prefetchLocal) abandonPrefetch();
          let localUrl: string;
          playbackEngine = "local";
          try {
            localUrl = prefetchText === text && prefetchUrl ? await prefetchUrl : await fetchKokoroUrl(text);
            prefetchText = null;
            prefetchUrl = null;
            if (!localUrl) throw new Error("Local synthesis failed");
          } catch {
            if (stopped) break;
            playbackEngine = "xfyun";
            try {
              localUrl = await fetchTtsUrl(
                text,
                scenarioId,
                controller.signal,
                overrides,
              );
            } catch {
              hadFailure = true;
              continue;
            }
          }
          if (stopped) {
            URL.revokeObjectURL(localUrl);
            break;
          }
          onPending = () => {
            if (stopped || prefetchUrl || !pending.length) return;
            prefetchLocal = true;
            prefetchText = pending[0];
            prefetchUrl = fetchKokoroUrl(prefetchText).catch(() => "");
          };
          playing = playUrl(localUrl, didStart);
          onPending();
          await playing.done;
          hadFailure ||= Boolean(playing.failed);
          onPending = null;
          continue;
        }

        if (canStreamAudio()) {
          playbackEngine = "xfyun";
          abandonPrefetch();
          const prepared = streamText === text ? await (streamResponse as Promise<Response | null> | null) : null;
          streamResponse = null;
          streamText = null;
          if (stopped) { await prepared?.body?.cancel().catch(() => undefined); break; }
          onPending = () => {
            if (stopped || streamResponse || !pending.length) return;
            streamText = pending[0];
            streamController = new AbortController();
            bindInteraction(streamController.signal, interactionId);
            streamResponse = fetchTtsStream(streamText, scenarioId, streamController.signal, overrides).catch(() => null);
          };
          playing = speakIflytek(text, scenarioId, overrides, () => { didStart(); onPending?.(); }, prepared ?? undefined, interactionId);
          await playing.done;
          hadFailure ||= Boolean(playing.failed);
          onPending = null;
          continue;
        }

        let url: string;
        playbackEngine = "xfyun";
        try {
          url =
            prefetchText === text && prefetchUrl
              ? await prefetchUrl
              : await fetchTtsUrl(
                  text,
                  scenarioId,
                  controller.signal,
                  overrides,
                );
        } catch {
          hadFailure = true;
          prefetchText = null;
          prefetchUrl = null;
          continue; // skip a sentence we couldn't synthesise; keep going
        }
        prefetchText = null;
        prefetchUrl = null;
        onPending = () => {
          if (stopped || prefetchUrl || !pending.length) return;
          prefetchLocal = false;
          prefetchText = pending[0];
          prefetchUrl = fetchTtsUrl(prefetchText, scenarioId, controller.signal, overrides).catch(() => "");
        };
        if (stopped || !url) {
          if (url) URL.revokeObjectURL(url);
          if (stopped) break;
          hadFailure = true;
          continue;
        }
        playing = playUrl(url, didStart);
        onPending();
        await playing.done;
        hadFailure ||= Boolean(playing.failed);
        onPending = null;
      }
      completedNormally = true;
    } finally {
      abandonPrefetch();
      abandonStream();
      if (spokenUpto > 0) reportTiming("speech.complete", performance.now() - queueAt, {
        engine: playbackEngine, interactionId, outcome: stopped ? "cancelled" : completedNormally && firstAudio && !hadFailure ? "ok" : "error",
      });
    }
  })();
  void consumer.catch(() => undefined); // end() observes failures after generation

  const queue: SpeechQueue = {
    feed: (full: string) => {
      if (stopped || noMore) return;
      const { sentences, consumed } = nextSentences(full, spokenUpto, false);
      spokenUpto = consumed;
      if (sentences.length) {
        pending.push(...sentences);
        onPending?.();
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
      await Promise.race([consumer, cancelled]);
    },
    started,
    stop: () => {
      stopped = true;
      controller.abort();
      abortPrefetch();
      playing?.stop();
      cancel();
      wakeUp();
    },
  };
  current = { done: consumer.catch(() => undefined), stop: queue.stop };
  return queue;
}
