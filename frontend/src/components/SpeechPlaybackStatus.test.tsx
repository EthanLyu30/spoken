import { afterEach, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { beginSpeechPlayback, useSpeechPlayback } from "../store/speechPlayback";
import { SpeechPlaybackStatus } from "./SpeechPlaybackStatus";
afterEach(() => useSpeechPlayback.setState({playback:null}));
it("shows a concise unavailable message without technical voice details", () => {
  const playback=beginSpeechPlayback("browser");
  playback.update({phase:"error",fallbackReason:"browser-unavailable"});
  render(<SpeechPlaybackStatus />);
  expect(screen.getByRole("alert")).toHaveTextContent("朗读暂时不可用");
  expect(screen.getByRole("alert")).not.toHaveTextContent("实际声音");
  expect(screen.getByRole("alert")).not.toHaveTextContent("Microsoft");
});
it("keeps playback status concise and hides the engine after a native failure", () => {
  const playback=beginSpeechPlayback("local");
  playback.update({effectiveEngine:"browser",voice:"Google US English",fallbackReason:"local-unavailable",phase:"speaking"});
  render(<SpeechPlaybackStatus />);
  expect(screen.getByRole("status")).toHaveTextContent("正在朗读");
  expect(screen.getByRole("status")).not.toHaveTextContent("实际声音");
  act(()=>playback.update({phase:"error",fallbackReason:"browser-start-failed"}));
  expect(screen.getByRole("alert")).toHaveTextContent("朗读暂时不可用");
  expect(screen.getByRole("alert")).not.toHaveTextContent("浏览器朗读未能完成");
});

it("suppresses inline errors when the App owns the shared error alert",()=>{
  const playback=beginSpeechPlayback("browser");playback.update({phase:"error",fallbackReason:"browser-unavailable"});
  render(<SpeechPlaybackStatus suppressInlineErrors />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("explains when English voices are missing so the learner can restore them",()=>{
  const playback=beginSpeechPlayback("browser");playback.update({phase:"error",fallbackReason:"browser-unavailable"});
  render(<SpeechPlaybackStatus />);
  expect(screen.getByRole("alert")).toHaveTextContent("英语音色");
  expect(screen.getByRole("alert")).toHaveTextContent("语音设置");
});

it("discloses the temporary system voice during and after recovered playback",()=>{
  const playback=beginSpeechPlayback("browser");
  playback.update({phase:"preparing",effectiveEngine:"browser",voice:"Microsoft Zira",fallbackReason:"browser-voice-unavailable"});
  render(<SpeechPlaybackStatus />);
  expect(screen.getByRole("status")).toHaveTextContent("准备系统英语音色");
  act(()=>playback.update({phase:"speaking"}));
  expect(screen.getByRole("status")).toHaveTextContent("系统英语音色");
  act(()=>playback.update({phase:"completed"}));
  expect(screen.getByRole("status")).toHaveTextContent("系统英语音色");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
