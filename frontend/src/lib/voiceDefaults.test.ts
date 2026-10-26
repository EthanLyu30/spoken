import { expect, it } from "vitest";
import { useVoice } from "../store/voice";
import { resolveVoiceMode } from "./voiceResolver";
import { createLocalSpeechBootstrap } from "./localSpeech/bootstrap";

it("defaults new users to cloud speech without depending on installed device voices", () => {
  expect(useVoice.getState().engine).toBe("iflytek");
});

it("resolves explicitly selected local speech without waiting for browser voices", async () => {
  const mode = await resolveVoiceMode("local" as Parameters<typeof resolveVoiceMode>[0], {
    listEnglishVoices: () => [{ lang: "en-US" } as SpeechSynthesisVoice],
    subscribe: () => () => {}, timeoutMs: 10,
  });
  expect(mode).toEqual({ kind: "iflytek", automaticFallback: true });
});

it("does not schedule model downloads until the user selects local speech", () => {
  let enabled = false;
  let scheduled = 0;
  const start = createLocalSpeechBootstrap({
    enabled: () => enabled,
    schedule: () => { scheduled++; return () => {}; },
    hasEnglishBrowserVoice: async () => false,
    preload: async () => {},
  });
  start();
  expect(scheduled).toBe(0);
  enabled = true;
  start();
  expect(scheduled).toBe(1);
});
