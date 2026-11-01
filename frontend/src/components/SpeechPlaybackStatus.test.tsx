import { afterEach, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { beginSpeechPlayback, useSpeechPlayback } from "../store/speechPlayback";
import { SpeechPlaybackStatus } from "./SpeechPlaybackStatus";
afterEach(() => useSpeechPlayback.setState({playback:null}));
it("shows a truthful unavailable error even when no engine could play", () => {
  const playback=beginSpeechPlayback("browser");
  playback.update({phase:"error",fallbackReason:"browser-unavailable"});
  render(<SpeechPlaybackStatus />);
  expect(screen.getByRole("alert")).toHaveTextContent("此设备暂无可用英文音色");
  expect(screen.getByRole("alert")).not.toHaveTextContent("实际声音");
  expect(screen.getByRole("alert")).not.toHaveTextContent("已切换");
});
it("shows the actual browser fallback and surfaces native startup failure", () => {
  const playback=beginSpeechPlayback("local");
  playback.update({effectiveEngine:"browser",voice:"Google US English",fallbackReason:"local-unavailable",phase:"speaking"});
  render(<SpeechPlaybackStatus />);
  expect(screen.getByRole("status")).toHaveTextContent("实际声音：浏览器语音 · Google US English");
  act(()=>playback.update({phase:"error",fallbackReason:"browser-start-failed"}));
  expect(screen.getByRole("alert")).toHaveTextContent("浏览器朗读未能完成");
  expect(screen.getByRole("alert")).toHaveTextContent("请重试或选择其他可用音色");
});
