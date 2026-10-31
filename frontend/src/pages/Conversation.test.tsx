import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ postChat: vi.fn(), postAsr: vi.fn(), streamChat: vi.fn(), speakText: vi.fn(), createSpeechQueue: vi.fn(), postFeedback: vi.fn(), postSession: vi.fn(), startVoiceCall: vi.fn(), startRecording: vi.fn() }));
vi.mock("../lib/api", () => ({ ...mocks }));
vi.mock("../lib/call", () => ({ startVoiceCall: mocks.startVoiceCall }));
vi.mock("../lib/recorder", () => ({ startRecording: mocks.startRecording }));
vi.mock("../lib/speech", () => ({ speakText: mocks.speakText, createSpeechQueue: mocks.createSpeechQueue }));
vi.mock("../components/ChatBubble", () => ({ ChatBubble: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("../components/Buddy", () => ({ Buddy: () => null }));
vi.mock("../components/PlayfulBackground", () => ({ PlayfulBackground: () => null }));
import Conversation from "./Conversation";
import { bindInteraction } from "../lib/telemetry";
import type { CallCallbacks } from "../lib/call";
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mocks.postChat.mockResolvedValue({ reply: "Hello" });
  mocks.speakText.mockReturnValue({ done: Promise.resolve(), stop: vi.fn() });
  mocks.postFeedback.mockResolvedValue({ overall: 80, scores: [] });
  mocks.postSession.mockResolvedValue({});
  mocks.startVoiceCall.mockResolvedValue({ end: vi.fn() });
});

it("reports buffered cloud recognition when the conversation falls back from streaming ASR", async () => {
  const samples: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
    samples.push(JSON.parse(String(options.body)));
    return new Response(null, { status: 202 });
  });
  mocks.postAsr.mockResolvedValue("A coffee, please.");
  const user = userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", { name: "开始语音对话" }));
  await waitFor(() => expect(mocks.startVoiceCall).toHaveBeenCalledOnce());
  const callbacks = mocks.startVoiceCall.mock.calls[0][0] as CallCallbacks;
  const controller = new AbortController();
  bindInteraction(controller.signal, "c".repeat(32));
  await expect(callbacks.transcribe(new Int16Array([1, -1]).buffer, "cloud", controller.signal)).resolves.toBe("A coffee, please.");
  expect(samples).toContainEqual(expect.objectContaining({ operation: "asr.transcribe", engine: "xfyun", transport: "buffered", outcome: "ok", interaction_id: "c".repeat(32) }));
});

it("does not treat failed whole-reply audio as a successful voice turn", async () => {
  mocks.createSpeechQueue.mockReturnValue({ started: Promise.resolve(), feed: vi.fn(), end: async () => {}, stop: vi.fn(), failed: true });
  mocks.streamChat.mockImplementationOnce(async (_id, _history, onText) => { onText("A complete reply."); return "A complete reply."; });
  const user = userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", { name: "开始语音对话" }));
  await waitFor(() => expect(mocks.startVoiceCall).toHaveBeenCalledOnce());
  const callbacks = mocks.startVoiceCall.mock.calls[0][0] as CallCallbacks;
  await expect(callbacks.reply("A coffee.", new ArrayBuffer(2), () => {}, new AbortController().signal)).rejects.toThrow("语音播放失败");
});

it("does not speak an interrupted reply and speaks the corrected retry at the same message index", async () => {
  const user = userEvent.setup();
  mocks.streamChat.mockImplementationOnce(async (_id, _history, onText) => {
    onText("Half a reply");
    throw new Error("回复中断");
  }).mockImplementationOnce(async (_id, _history, onText) => { onText("Complete reply"); return "Complete reply"; });
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", { name: "文字练习" }));
  await user.type(screen.getByRole("textbox", { name: "英文回复" }), "A latte please.");
  await user.click(screen.getByRole("button", { name: /^发送$/ }));
  await screen.findByRole("button", { name: "重试回复" });
  expect(mocks.speakText.mock.calls.map(([text]) => text)).toEqual(["Hello"]);
  await user.click(screen.getByRole("button", { name: "重试回复" }));
  await waitFor(() => expect(mocks.speakText.mock.calls.map(([text]) => text)).toEqual(["Hello", "Complete reply"]));
});

it("does not send a previous identity's unmount feedback result as a new account's session", async () => {
  const { setToken } = await import("../lib/authToken");
  setToken("conversation-a");
  let feedback!: (value: object) => void;
  mocks.postFeedback.mockReturnValueOnce(new Promise(resolve => { feedback = resolve; }));
  mocks.streamChat.mockImplementationOnce(async (_id, _history, onText) => { onText("Enjoy your coffee."); return "Enjoy your coffee."; });
  const user = userEvent.setup();
  const view = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", { name: "文字练习" }));
  await user.type(screen.getByRole("textbox", { name: "英文回复" }), "A latte please.");
  await user.click(screen.getByRole("button", { name: /^发送$/ }));
  await screen.findByText("Enjoy your coffee.");
  view.unmount();
  expect(mocks.postFeedback).toHaveBeenCalledTimes(1);
  setToken("conversation-b");
  feedback({ overall: 80, scores: [] });
  await Promise.resolve(); await Promise.resolve();
  expect(mocks.postSession).not.toHaveBeenCalled();
});

it("does not even request unmount feedback after a synchronous identity change", async () => {
  const { setToken } = await import("../lib/authToken");
  setToken("conversation-before");
  mocks.streamChat.mockImplementationOnce(async (_id, _history, onText) => { onText("Enjoy your coffee."); return "Enjoy your coffee."; });
  const user = userEvent.setup();
  const view = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", { name: "文字练习" }));
  await user.type(screen.getByRole("textbox", { name: "英文回复" }), "A latte please.");
  await user.click(screen.getByRole("button", { name: /^发送$/ }));
  await screen.findByText("Enjoy your coffee.");
  setToken("conversation-after"); view.unmount();
  expect(mocks.postFeedback).not.toHaveBeenCalled();
});

it("does not fall back to a new-credential chat request when an old stream fails", async () => {
  const { setToken } = await import("../lib/authToken");
  setToken("stream-owner-a");
  let reject!: (error: Error) => void;
  mocks.streamChat.mockReturnValueOnce(new Promise((_resolve, r) => { reject = r; }));
  const user = userEvent.setup();
  const view = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", { name: "文字练习" }));
  await user.type(screen.getByRole("textbox", { name: "英文回复" }), "A latte please.");
  await user.click(screen.getByRole("button", { name: /^发送$/ }));
  setToken("stream-owner-b"); reject(new Error("identity changed"));
  await Promise.resolve(); await Promise.resolve();
  expect(mocks.postChat).toHaveBeenCalledTimes(1);
  view.unmount();
});

it.each(["identity", "unmount"])("cancels the push-to-talk transcription signal on %s", async reason => {
  const { setToken } = await import("../lib/authToken");
  setToken("microphone-a");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  mocks.startRecording.mockResolvedValue({ stop: vi.fn().mockResolvedValue(new ArrayBuffer(1280)) });
  let finish!: (value: string) => void;
  mocks.postAsr.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup();
  const view = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", { name: "文字练习" }));
  await user.click(screen.getByRole("button", { name: "开始录音" }));
  await user.click(await screen.findByRole("button", { name: "结束录音" }));
  await waitFor(() => expect(mocks.postAsr).toHaveBeenCalledOnce());
  const signal = mocks.postAsr.mock.calls[0][1] as AbortSignal | undefined;
  if (reason === "identity") setToken("microphone-b"); else view.unmount();
  expect(signal?.aborted).toBe(true);
  finish("");
});
