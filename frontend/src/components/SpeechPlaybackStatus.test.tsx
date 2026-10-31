import { afterEach, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { beginSpeechPlayback, useSpeechPlayback } from "../store/speechPlayback";
import { SpeechPlaybackStatus } from "./SpeechPlaybackStatus";

afterEach(() => useSpeechPlayback.setState({playback:null}));

it("shows the effective fallback voice and surfaces a failed preview", () => {
  const playback=beginSpeechPlayback("browser");
  playback.update({effectiveEngine:"xfyun",voice:"Lindsey",fallbackReason:"browser-unavailable",phase:"speaking"});
  render(<SpeechPlaybackStatus />);
  expect(screen.getByRole("status")).toHaveTextContent("实际声音：讯飞云端 · Lindsey");
  expect(screen.getByText("浏览器音色未能启动，已切换备用声音。")).toBeVisible();
  act(()=>playback.update({phase:"error"}));
  expect(screen.getByRole("alert")).toHaveTextContent("播放失败");
  expect(screen.getByRole("alert")).toHaveTextContent("请重试或选择其他可用音色");
});
