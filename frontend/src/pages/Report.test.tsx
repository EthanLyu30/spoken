import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ postFeedback: vi.fn(), postSession: vi.fn(), getWords: vi.fn() }));
vi.mock("../lib/api", () => api);
vi.mock("../components/Buddy", () => ({ Buddy: () => null }));
vi.mock("../components/PlayfulBackground", () => ({ PlayfulBackground: () => null }));
vi.mock("../components/dictionary/InteractiveEnglishText", () => ({ InteractiveEnglishText: ({ text }: { text: string }) => <span>{text}</span> }));
import Report from "./Report";
import { useSession } from "../store/session";
import { useWords } from "../store/words";
import { setToken } from "../lib/authToken";
const feedback = { overall: 80, summary: "Nice work", tip: "Keep going", scores: [], corrections: [], phrases: [] };
let sequence = 0;
beforeEach(() => {
  vi.resetAllMocks();
  setToken(`report-${++sequence}`);
  useSession.getState().setSession("cafe", [{ role: "user", content: "Coffee please" }], `practice-${sequence}`);
  useWords.getState().reset(); api.getWords.mockResolvedValue([]);
  api.postFeedback.mockResolvedValue(feedback); api.postSession.mockResolvedValue({});
});
const mount = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Report /></MemoryRouter>);
it("does not save feedback that completes after an identity transition", async () => {
  let resolve!: (value: typeof feedback) => void;
  api.postFeedback.mockReturnValue(new Promise(r => { resolve = r; }));
  mount();
  setToken("report-other");
  await act(async () => { resolve(feedback); });
  expect(api.postSession).not.toHaveBeenCalled();
  expect(screen.queryByText("Nice work")).not.toBeInTheDocument();
});
it("does not retry saving an old report with a new credential before React unmounts", async () => {
  api.postSession.mockRejectedValueOnce(new Error("offline"));
  mount();
  const retry = await screen.findByRole("button", { name: "重试保存" });
  setToken("report-other");
  await userEvent.click(retry);
  expect(api.postSession).toHaveBeenCalledTimes(1);
});
it("still retries a failed save under the same identity", async () => {
  api.postSession.mockRejectedValueOnce(new Error("offline"));
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "重试保存" })).not.toBeInTheDocument());
  expect(api.postSession).toHaveBeenCalledTimes(2);
});
