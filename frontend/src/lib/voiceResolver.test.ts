import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_CLOUD_PITCH,
  AUTO_CLOUD_SPEED,
  AUTO_CLOUD_VOICE,
  autoCloudOverrides,
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

  it("uses explicit cloud mode immediately", async () => {
    await expect(
      resolveVoiceMode("iflytek", {
        listEnglishVoices: () => [],
        subscribe: () => () => undefined,
        timeoutMs: 500,
      }),
    ).resolves.toEqual({
      kind: "iflytek",
      automaticFallback: false,
    });
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

  it("falls back after 500 ms and respects user cloud overrides", async () => {
    vi.useFakeTimers();
    const pending = resolveVoiceMode("browser", {
      listEnglishVoices: () => [],
      subscribe: () => () => undefined,
      timeoutMs: 500,
    });

    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toEqual({
      kind: "iflytek",
      automaticFallback: true,
    });
    expect(
      autoCloudOverrides({
        vcn: null,
        speed: null,
        pitch: null,
      }),
    ).toEqual({
      vcn: AUTO_CLOUD_VOICE,
      speed: AUTO_CLOUD_SPEED,
      pitch: AUTO_CLOUD_PITCH,
    });
    expect(
      autoCloudOverrides({
        vcn: "henry",
        speed: 40,
        pitch: 60,
      }),
    ).toEqual({
      vcn: "henry",
      speed: 40,
      pitch: 60,
    });
  });
});
