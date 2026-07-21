import { describe, expect, it } from "vitest";
import { isAsrFastEnough, isTtsFastEnough } from "./performance";

describe("local TTS performance gate", () => {
  it("accepts synthesis that stays close to real time", () => {
    expect(
      isTtsFastEnough({
        elapsedMs: 1_100,
        sampleCount: 24_000,
        sampleRate: 24_000,
      }),
    ).toBe(true);
  });

  it("rejects local synthesis that would make conversation noticeably wait", () => {
    expect(
      isTtsFastEnough({
        elapsedMs: 1_500,
        sampleCount: 24_000,
        sampleRate: 24_000,
      }),
    ).toBe(false);
  });

  it("rejects invalid benchmark output", () => {
    expect(
      isTtsFastEnough({
        elapsedMs: 1,
        sampleCount: 0,
        sampleRate: 24_000,
      }),
    ).toBe(false);
  });
});

describe("local ASR performance gate", () => {
  it("accepts Moonshine when inference finishes within the audio duration", () => {
    expect(
      isAsrFastEnough({
        elapsedMs: 800,
        sampleCount: 16_000,
        sampleRate: 16_000,
      }),
    ).toBe(true);
  });

  it("rejects Moonshine when a short utterance would take longer than real time", () => {
    expect(
      isAsrFastEnough({
        elapsedMs: 1_100,
        sampleCount: 16_000,
        sampleRate: 16_000,
      }),
    ).toBe(false);
  });
});
