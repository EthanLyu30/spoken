import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ postChat: vi.fn(), streamChat: vi.fn(), speakText: vi.fn(), postFeedback: vi.fn(), postSession: vi.fn() }));
vi.mock("../lib/api", () => ({ ...mocks }));
vi.mock("../lib/speech", () => ({ speakText: mocks.speakText, createSpeechQueue: vi.fn() }));
vi.mock("../components/ChatBubble", () => ({ ChatBubble: ({ text }: { text: string }) => <div>{text}</div> }));
vi.mock("../components/Buddy", () => ({ Buddy: () => null }));
vi.mock("../components/PlayfulBackground", () => ({ PlayfulBackground: () => null }));
import Conversation from "./Conversation";
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  mocks.postChat.mockResolvedValue({ reply: "Hello" });
  mocks.speakText.mockReturnValue({ done: Promise.resolve(), stop: vi.fn() });
  mocks.postFeedback.mockResolvedValue({ overall: 80, scores: [] });
  mocks.postSession.mockResolvedValue({});
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
