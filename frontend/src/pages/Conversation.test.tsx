import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ postChat: vi.fn(), postAsr: vi.fn(), streamChat: vi.fn(), speakText: vi.fn(), prepareSpeech: vi.fn(), createSpeechQueue: vi.fn(), postFeedback: vi.fn(), postSession: vi.fn(), startVoiceCall: vi.fn(), startRecording: vi.fn() }));
vi.mock("../lib/api", () => ({ ...mocks }));
vi.mock("../lib/call", () => ({ startVoiceCall: mocks.startVoiceCall }));
vi.mock("../lib/recorder", () => ({ startRecording: mocks.startRecording }));
vi.mock("../lib/speech", () => ({ speakText: mocks.speakText, prepareSpeech: mocks.prepareSpeech, createSpeechQueue: mocks.createSpeechQueue }));
vi.mock("../components/ChatBubble", () => ({ ChatBubble: ({ text, onSpeak }: { text: string; onSpeak?: () => void }) => <div>{text}{onSpeak && <button onClick={onSpeak}>Replay {text}</button>}</div> }));
vi.mock("../components/Buddy", () => ({ Buddy: () => null }));
vi.mock("../components/PlayfulBackground", () => ({ PlayfulBackground: () => null }));
import Conversation from "./Conversation";
import { bindInteraction, getInteraction } from "../lib/telemetry";
import type { CallCallbacks } from "../lib/call";
import { MAX_AUDIO_BYTES } from "../lib/audioLimits";
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mocks.prepareSpeech.mockImplementation(() => ({ dispose: vi.fn(), consume: vi.fn() }));
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

it("stops ordinary recording when the audio byte limit is exceeded without starting ASR", async () => {
  let emit: ((pcm: ArrayBuffer) => void) | undefined;
  let captureSignal: AbortSignal | undefined;
  mocks.startRecording.mockImplementation(async (onPcm, signal) => {
    emit = onPcm; captureSignal = signal;
    return { stop: vi.fn().mockResolvedValue(new ArrayBuffer(1280)) };
  });
  const user = userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", { name: "开始录音" }));
  act(() => emit?.(new ArrayBuffer(MAX_AUDIO_BYTES + 1)));
  expect(captureSignal?.aborted).toBe(true);
  expect(screen.getByText("录音最长180秒，请缩短后再试。")).toBeInTheDocument();
  expect(mocks.postAsr).not.toHaveBeenCalled();
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


it("prepares typed replies before generation and passes the same request identity to final autoplay", async () => {
  let complete!: (reply: string) => void;
  mocks.streamChat.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const user = userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", {name: "文字练习"}));
  await user.type(screen.getByRole("textbox", {name: "英文回复"}), "A coffee.");
  await user.click(screen.getByRole("button", {name: /^发送$/}));
  expect(mocks.prepareSpeech).toHaveBeenCalledOnce();
  expect(mocks.prepareSpeech.mock.invocationCallOrder[0]).toBeLessThan(mocks.streamChat.mock.invocationCallOrder[0]);
  expect(mocks.createSpeechQueue).not.toHaveBeenCalled();
  expect(mocks.speakText.mock.calls.map(([text]) => text)).toEqual(["Hello"]);
  const signal = mocks.streamChat.mock.calls[0][3] as AbortSignal;
  expect(getInteraction(signal)).toMatch(/^[a-f0-9]{32}$/);
  complete("Fresh reply.");
  await screen.findByText("Fresh reply.");
  await waitFor(() => expect(mocks.speakText).toHaveBeenLastCalledWith("Fresh reply.", "cafe", expect.objectContaining({preparation: mocks.prepareSpeech.mock.results[0].value, interactionId: getInteraction(signal), submittedAt: expect.any(Number)})));
  expect(screen.getByRole("textbox", {name: "英文回复"})).toBeEnabled();
});


async function pendingTypedReply() {
  let complete!: (reply: string) => void;
  mocks.streamChat.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const user = userEvent.setup();
  const view = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", {name: "文字练习"}));
  await user.type(screen.getByRole("textbox", {name: "英文回复"}), "Coffee.");
  await user.click(screen.getByRole("button", {name: /^发送$/}));
  return {user, view, complete};
}
it("does not prepare cloud speech for a reply sent while already muted", async () => {
  const user=userEvent.setup();
  mocks.streamChat.mockImplementationOnce(async(_id,_history,onText)=>{onText("Muted reply.");return "Muted reply.";});
  render(<MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation/>}/></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button",{name:"关闭朗读"}));
  await user.click(screen.getByRole("button",{name:"文字练习"}));
  await user.type(screen.getByRole("textbox",{name:"英文回复"}),"A coffee.");
  await user.click(screen.getByRole("button",{name:/^发送$/}));
  await screen.findByText("Muted reply.");
  expect(mocks.prepareSpeech).not.toHaveBeenCalled();
  expect(mocks.speakText.mock.calls.map(([text])=>text)).toEqual(["Hello"]);
});
it("keeps manual replay independent while a fresh reply is generating", async () => {
  const {user, complete} = await pendingTypedReply();
  const stop = vi.fn();
  mocks.speakText.mockReturnValueOnce({stop, done: new Promise(() => {})});
  await user.click(screen.getByRole("button", {name:"Replay Hello"}));
  expect(stop).not.toHaveBeenCalled();
  expect(mocks.speakText).toHaveBeenLastCalledWith("Hello", "cafe", undefined);
  expect(mocks.prepareSpeech.mock.results[0].value.dispose).not.toHaveBeenCalled();
  complete("Fresh."); await screen.findByText("Fresh.");
  expect(stop).toHaveBeenCalledOnce();
  expect(mocks.speakText).toHaveBeenLastCalledWith("Fresh.", "cafe", expect.objectContaining({preparation:mocks.prepareSpeech.mock.results[0].value}));
});
it.each(["mute", "identity", "unmount"])("disposes pending discovery on %s and suppresses stale autoplay", async reason => {
  const {user, view, complete} = await pendingTypedReply();
  const preparation = mocks.prepareSpeech.mock.results[0].value;
  const signal = mocks.streamChat.mock.calls[0][3] as AbortSignal;
  if (reason === "mute") await user.click(screen.getByRole("button", {name:"关闭朗读"}));
  else if (reason === "identity") { const {setToken} = await import("../lib/authToken"); setToken("new-identity-" + Date.now()); }
  else view.unmount();
  expect(preparation.dispose).toHaveBeenCalled();
  if (reason !== "mute") expect(signal.aborted).toBe(true);
  complete("Should not autoplay.");
  if (reason === "mute") {
    await screen.findByText("Should not autoplay.");
    await user.click(screen.getByRole("button", {name:"开启朗读"}));
  } else await Promise.resolve();
  expect(mocks.speakText.mock.calls.map(([text]) => text)).toEqual(["Hello"]);
});
it("reuses typed discovery through plain fallback and releases sending before audio ends", async () => {
  mocks.streamChat.mockRejectedValueOnce(new Error("Unavailable"));
  mocks.postChat.mockResolvedValueOnce({reply:"Hello"}).mockResolvedValueOnce({reply:"Plain reply."});
  const user = userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  mocks.speakText.mockReturnValue({stop:vi.fn(), done:new Promise(() => {})});
  await user.click(screen.getByRole("button", {name:"文字练习"}));
  await user.type(screen.getByRole("textbox", {name:"英文回复"}), "Coffee.");
  await user.click(screen.getByRole("button", {name:/^发送$/}));
  await screen.findByText("Plain reply.");
  expect(mocks.prepareSpeech).toHaveBeenCalledOnce();
  expect(mocks.speakText).toHaveBeenLastCalledWith("Plain reply.", "cafe", expect.objectContaining({preparation:mocks.prepareSpeech.mock.results[0].value}));
  expect(screen.getByRole("textbox", {name:"英文回复"})).toBeEnabled();
});
it("prepares voice discovery after push-to-talk ASR and before its model request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null,{status:202})));
  mocks.startRecording.mockResolvedValue({stop:vi.fn().mockResolvedValue(new ArrayBuffer(1280))});
  mocks.postAsr.mockResolvedValueOnce("Coffee please.");
  mocks.streamChat.mockResolvedValueOnce("Here you go.");
  const user = userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button", {name:"文字练习"}));
  await user.click(screen.getByRole("button", {name:"开始录音"}));
  await user.click(await screen.findByRole("button", {name:"结束录音"}));
  await screen.findByText("Here you go.");
  expect(mocks.prepareSpeech.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.postAsr.mock.invocationCallOrder[0]);
  expect(mocks.prepareSpeech.mock.invocationCallOrder[0]).toBeLessThan(mocks.streamChat.mock.invocationCallOrder[0]);
  const asrSignal = mocks.postAsr.mock.calls[0][1] as AbortSignal;
  const chatSignal = mocks.streamChat.mock.calls[0][3] as AbortSignal;
  const interactionId = getInteraction(asrSignal);
  expect(interactionId).toMatch(/^[a-f0-9]{32}$/);
  expect(getInteraction(chatSignal)).toBe(interactionId);
  expect(mocks.speakText.mock.calls.at(-1)?.[2]).toMatchObject({ interactionId });
});
it("prepares call plain fallback discovery before requesting the fallback reply", async () => {
  const queue = {started:new Promise(() => {}),feed:vi.fn(),end:vi.fn().mockResolvedValue(undefined),stop:vi.fn()};
  mocks.createSpeechQueue.mockReturnValue(queue);
  mocks.streamChat.mockRejectedValueOnce(new Error("Unavailable"));
  const user=userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button",{name:"开始语音对话"}));
  const callbacks=mocks.startVoiceCall.mock.calls[0][0] as CallCallbacks;
  await callbacks.reply("Coffee.",new ArrayBuffer(2),()=>{},new AbortController().signal);
  expect(mocks.prepareSpeech).toHaveBeenCalledOnce();
  expect(mocks.prepareSpeech.mock.invocationCallOrder[0]).toBeLessThan(mocks.postChat.mock.invocationCallOrder[1]);
});


it("ends the active call on identity change so independent fallback discovery is aborted", async () => {
  const controller=new AbortController(); const end=vi.fn(()=>controller.abort());
  mocks.startVoiceCall.mockResolvedValueOnce({end});
  const user=userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button",{name:"开始语音对话"}));
  await waitFor(()=>expect(mocks.startVoiceCall).toHaveBeenCalledOnce());
  const {setToken}=await import("../lib/authToken");setToken("call-owner-changed");
  expect(end).toHaveBeenCalledOnce();expect(controller.signal.aborted).toBe(true);
});


it("releases call fallback discovery immediately when muted during the pending plain request", async () => {
  const {prepareSpeech} = await vi.importActual<typeof import("../lib/speech")>("../lib/speech");
  mocks.prepareSpeech.mockImplementation(prepareSpeech);
  const addEventListener=vi.fn(), removeEventListener=vi.fn(), speak=vi.fn();
  vi.stubGlobal("SpeechSynthesisUtterance",class {});
  vi.stubGlobal("speechSynthesis",{getVoices:()=>[],addEventListener,removeEventListener,speak});
  const queue={started:new Promise(() => {}),feed:vi.fn(),end:vi.fn().mockResolvedValue(undefined),stop:vi.fn()};
  mocks.createSpeechQueue.mockReturnValue(queue);
  mocks.streamChat.mockRejectedValueOnce(new Error("Unavailable"));
  const user=userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/practice/cafe"]}><Routes><Route path="/practice/:scenarioId" element={<Conversation />} /></Routes></MemoryRouter>);
  await screen.findByText("Hello");
  await user.click(screen.getByRole("button",{name:"开始语音对话"}));
  let complete!: (value:{reply:string})=>void;
  mocks.postChat.mockReturnValueOnce(new Promise(resolve=>{complete=resolve;}));
  const callbacks=mocks.startVoiceCall.mock.calls[0][0] as CallCallbacks;
  const timer=vi.spyOn(window,"setTimeout");
  const clear=vi.spyOn(window,"clearTimeout");
  const controller=new AbortController();
  const pending=callbacks.reply("Coffee.",new ArrayBuffer(2),()=>{},controller.signal);
  try {
    await waitFor(()=>expect(mocks.postChat).toHaveBeenCalledTimes(2));
    const discoveryTimer=timer.mock.results[timer.mock.calls.findIndex(([,delay])=>delay===500)].value;
    expect(addEventListener).toHaveBeenCalledWith("voiceschanged",expect.any(Function));
    expect(removeEventListener).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button",{name:"关闭朗读"}));
    expect(removeEventListener).toHaveBeenCalledWith("voiceschanged",addEventListener.mock.calls[0][1]);
    expect(clear).toHaveBeenCalledWith(discoveryTimer);
    expect(mocks.prepareSpeech.mock.results[0].value.consume()).toBeUndefined();
    expect(speak).not.toHaveBeenCalled();
    complete({reply:"Muted final reply."});await pending;
    expect(queue.end).toHaveBeenCalledWith("");
    expect(mocks.speakText.mock.calls.map(([text])=>text)).toEqual(["Hello"]);
  } finally {
    controller.abort();complete?.({reply:"Cleanup"});await pending.catch(()=>undefined);
    timer.mockRestore();clear.mockRestore();
  }
});
