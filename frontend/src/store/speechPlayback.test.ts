import { expect, it } from "vitest";
import { beginSpeechPlayback, useSpeechPlayback } from "./speechPlayback";

it("keeps a replaced task's delayed failure from overwriting the current voice", () => {
  const old = beginSpeechPlayback("iflytek");
  old.update({phase:"preparing",effectiveEngine:"xfyun"});
  const next = beginSpeechPlayback("browser");
  next.update({phase:"speaking",effectiveEngine:"browser",voice:"Google US English"});
  old.update({phase:"error"});
  expect(useSpeechPlayback.getState().playback).toEqual(next.status);
  expect(old.status.phase).toBe("error");
  expect(next.status.phase).toBe("speaking");
});
