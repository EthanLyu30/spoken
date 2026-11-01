import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveVoiceMode,
} from "./voiceResolver";

const englishVoice = {
  lang: "en-US",
  name: "English",
  voiceURI: "en",
} as SpeechSynthesisVoice;

describe("voiceResolver", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels pending discovery immediately and removes its listener and timer", async () => {
    vi.useFakeTimers();
    const controller=new AbortController(), unsubscribe=vi.fn();
    const pending=resolveVoiceMode("browser",{listEnglishVoices:()=>[],subscribe:()=>unsubscribe,timeoutMs:500},controller.signal);
    controller.abort();
    await expect(pending).resolves.toEqual({kind:"unavailable"});
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses an English browser voice immediately when present", async () => {
    await expect(
      resolveVoiceMode("browser", {
        listEnglishVoices: () => [englishVoice],
        subscribe: () => () => undefined,
        timeoutMs: 500,
      }),
    ).resolves.toEqual({ kind: "browser" });
  });

  it("waits for a delayed voiceschanged event", async () => {
    let voices: SpeechSynthesisVoice[] = [];
    let notify: () => void = () => undefined;
    const pending = resolveVoiceMode("browser", {
      listEnglishVoices: () => voices,
      subscribe: (callback) => {
        notify = callback;
        return () => undefined;
      },
      timeoutMs: 500,
    });

    voices = [englishVoice];
    notify();

    await expect(pending).resolves.toEqual({ kind: "browser" });
  });

  it("reports unavailable after the discovery deadline without choosing a cloud engine", async () => {
    vi.useFakeTimers();
    const unsubscribe=vi.fn();
    const pending=resolveVoiceMode("browser", {listEnglishVoices:()=>[],subscribe:()=>unsubscribe,timeoutMs:500});
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({kind:"unavailable"});
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
