import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ getSession: vi.fn(), postFeedback: vi.fn(), postSession: vi.fn(), getWords: vi.fn(), postTurnCorrection: vi.fn(), setCorrectionPractice: vi.fn() }));
vi.mock("../lib/api", () => api);
vi.mock("../components/Buddy", () => ({ Buddy: () => null }));
vi.mock("../components/dictionary/InteractiveEnglishText", () => ({ InteractiveEnglishText: ({ text }: { text: string }) => <span>{text}</span> }));
import Report from "./Report";
import { useSession } from "../store/session";
import { useCustomScene } from "../store/custom";
import { useWords } from "../store/words";
import { setToken } from "../lib/authToken";
import { persistSessionOnce, unscoredSession } from "../lib/sessionSave";
const feedback = { overall: 80, summary: "Nice work", tip: "Keep going", scores: [], corrections: [], phrases: [] };
let sequence = 0;
beforeEach(() => {
  vi.resetAllMocks();
  useCustomScene.getState().clear();
  setToken(`report-${++sequence}`);
  useSession.getState().setSession("cafe", [{ role: "user", content: "Coffee please" }], `practice-${sequence}`);
  useWords.getState().reset(); api.getWords.mockResolvedValue([]);
  api.postFeedback.mockResolvedValue(feedback); api.postSession.mockResolvedValue({});
});
const mount = (id = useSession.getState().practiceId) => render(
  <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[`/report/${id}`]}>
    <Routes><Route path="/report/:sessionId" element={<Report />} /></Routes>
  </MemoryRouter>,
);
const openSaved = (query = "") => render(<MemoryRouter initialEntries={[`/report/saved/18${query}`]}>
  <Routes><Route path="/report/saved/:savedSessionId" element={<Report />} /></Routes>
</MemoryRouter>);

it("saves the scene from the conversation even when a different custom scene is now active", async () => {
  const original = { title: "Bike repair", title_zh: "修自行车", partner_role: "Mechanic", goal: "Get a price",
    persona: "Repair bikes", opening_line: "What's broken?" };
  useSession.getState().setSession("custom", [{ role: "user", content: "How much is a new wheel?" }], `custom-${sequence}`, [], original);
  useCustomScene.getState().setScene({ ...original, title: "Museum tickets", title_zh: "博物馆买票" });
  mount();
  await screen.findByRole("heading", { name: "Nice work" });
  await waitFor(() => expect(api.postSession).toHaveBeenCalledWith(expect.objectContaining({ scenario_id: "custom", custom: original })));
  expect(api.postFeedback).toHaveBeenCalledWith("custom", expect.any(Array), expect.any(AbortSignal), original);
});

it("keeps a marked learner sentence in the report and saved session even when the AI lists no fixes", async () => {
  const mark = { original: "latte", suggestion: "a latte", note: "可数名词前加 a", category: "articles" as const,
    turn_index: 1, marked: true };
  useSession.getState().setSession("cafe", [
    { role: "assistant", content: "What can I get you?" },
    { role: "user", content: "I'd like latte, please." },
  ], `marked-${sequence}`, [mark]);
  mount();
  expect(await screen.findByText("你的第 1 句")).toBeVisible();
  expect(api.postSession).toHaveBeenCalledWith(expect.objectContaining({ corrections: [mark] }));
  await userEvent.click(screen.getByRole("button", { name: "重练原句" }));
  expect(screen.getAllByText("I'd like latte, please.").length).toBeGreaterThan(0);
  api.postTurnCorrection.mockResolvedValue({ natural: true, suggestion: "I'd like a latte, please.", issues: [], explanation: "冠词用对了。" });
  await userEvent.type(screen.getByRole("textbox", { name: "这次的说法" }), "I'd like a latte, please.");
  await userEvent.click(screen.getByRole("button", { name: "检查这次说法" }));
  expect(await screen.findByText("冠词用对了。")).toBeVisible();
  expect(api.postTurnCorrection).toHaveBeenCalledWith(expect.objectContaining({
    text: "I'd like a latte, please.", replay_original: "I'd like latte, please.", previous_partner_message: "What can I get you?",
  }), expect.any(AbortSignal));
});

it("renders the original and corrected whole favorite without offering practice even when feedback lists no fixes", async () => {
  const original = "I'd like latte, please.";
  const suggestion = "I'd like a latte, please.";
  const messages = [{ role: "user" as const, content: original }];
  const favorite = { original, suggestion, note: "", turn_index: 0, marked: true, self_marked: true };
  useSession.getState().setSession("cafe", messages, `favorite-${sequence}`, [favorite]);
  api.postSession.mockResolvedValueOnce({ ...feedback, id: 18, corrections: [favorite] });
  const live = mount();
  const checkFavorite = async () => {
    const review = within(await screen.findByRole("region", { name: "句子纠错" }));
    expect(review.getByText(original)).toBeVisible();
    expect(review.getByText(suggestion)).toBeVisible();
    expect(review.getByText("已收藏")).toBeVisible();
    expect(review.queryByRole("button", { name: /复练|填空|中译英/ })).not.toBeInTheDocument();
  };
  await checkFavorite();
  expect(api.postSession).toHaveBeenCalledWith(expect.objectContaining({ corrections: [favorite] }));
  live.unmount();
  useSession.getState().clear();
  api.getSession.mockResolvedValueOnce({ ...feedback, id: 18, scenario_id: "cafe", messages, corrections: [favorite] });
  openSaved();
  await checkFavorite();
  expect(api.postFeedback).toHaveBeenCalledTimes(1);
});

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

it("saves the transcript and marked sentence on feedback failure, then sends a score for the same practice", async () => {
  const content = "Coffee please";
  const mark = { original: content, suggestion: "", note: "", marked: true, self_marked: true, turn_index: 0 };
  const messages = [{ role: "user" as const, content }];
  useSession.getState().setSession("cafe", messages, `retry-grade-${sequence}`, [mark]);
  api.postFeedback.mockRejectedValueOnce(new Error("temporarily unavailable"));
  mount();
  expect(await screen.findByRole("link", {name: /对话已保存为未评分/})).toBeVisible();
  const samePractice = { client_session_id: `retry-grade-${sequence}`, messages, corrections: [mark] };
  expect(api.postSession).toHaveBeenNthCalledWith(1, expect.objectContaining({...samePractice, overall: null, scores: []}));
  await userEvent.click(screen.getByRole("button", {name: "重试生成"}));
  expect(await screen.findByRole("heading", {name: "Nice work"})).toBeVisible();
  expect(api.postSession).toHaveBeenNthCalledWith(2, expect.objectContaining({...samePractice, overall: 80}));
});

it("saves a favorite confirmed after an unscored checkpoint when the summary score fails", async () => {
  const original = "I coordinate three team.";
  const suggestion = "I coordinate three teams.";
  const favorite = { original, suggestion, note: "", marked: true, self_marked: true, turn_index: 0 };
  const messages = [{ role: "user" as const, content: original }];
  const practiceId = `stop-then-favorite-${sequence}`;
  const checkpoint = { ...unscoredSession([]), id: 18, scenario_id: "interview", created_at: "2026-11-25T08:00:00.000123",
    client_session_id: practiceId, messages };
  api.postSession.mockResolvedValueOnce(checkpoint).mockResolvedValueOnce({ ...checkpoint, corrections: [favorite] });
  await persistSessionOnce("interview", messages, unscoredSession([]), practiceId);

  useSession.getState().setSession("interview", messages, practiceId, [favorite]);
  api.postFeedback.mockRejectedValueOnce(new Error("temporarily unavailable"));
  const active = mount();
  const review = within(await screen.findByRole("region", { name: "句子纠错" }));
  expect(review.getByText(original)).toBeVisible();
  expect(review.getByText(suggestion)).toBeVisible();
  expect(review.getByText("已收藏")).toBeVisible();
  expect(screen.getByRole("link", { name: /对话已保存为未评分/ })).toHaveAttribute("href",
    "/session/18?created_at=2026-11-25T08%3A00%3A00.000123");
  expect(review.queryByRole("button", { name: /重练原句|填空|中译英/ })).not.toBeInTheDocument();
  expect(api.postSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
    client_session_id: practiceId, messages, overall: null, scores: [], corrections: [favorite],
  }));

  active.unmount();
  api.getSession.mockResolvedValueOnce({ ...checkpoint, corrections: [favorite] });
  api.postFeedback.mockRejectedValueOnce(new Error("still unavailable"));
  openSaved();
  expect(await screen.findByText(suggestion)).toBeVisible();
  expect(api.postSession).toHaveBeenCalledTimes(2);
});

it("opens a history report without in-memory state and displays the saved score from a competing write", async () => {
  useSession.getState().clear();
  const messages = [{role: "user", content: "Coffee please"}];
  const mark = {original: "Coffee please", suggestion: "", note: "", marked: true, self_marked: true, turn_index: 0};
  api.getSession.mockResolvedValue({id: 18, scenario_id: "cafe", client_session_id: "history-rescore", overall: null,
    messages, corrections: [mark]});
  api.postSession.mockResolvedValue({overall: 0, summary: "已保存的评分", tip: "", scores: [], corrections: [mark]});
  openSaved();
  expect(await screen.findByRole("heading", {name: "已保存的评分"})).toBeVisible();
  expect(screen.getByText("0")).toBeVisible();
  expect(screen.queryByText("80")).not.toBeInTheDocument();
  expect(screen.getByText("已收藏")).toBeVisible();
  expect(screen.queryByRole("button", {name: "重练原句"})).not.toBeInTheDocument();
  expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
  expect(api.postSession).toHaveBeenCalledWith(expect.objectContaining({client_session_id: "history-rescore", corrections: [mark], overall: 80}));
});

it("reads an already graded history report without asking for a fresh score", async () => {
  useSession.getState().clear();
  api.getSession.mockResolvedValue({id: 18, scenario_id: "cafe", overall: 62, summary: "原来的小结", scores: [],
    messages: [{role: "user", content: "Coffee please"}]});
  openSaved();
  expect(await screen.findByRole("heading", {name: "原来的小结"})).toBeVisible();
  expect(screen.getByText("62")).toBeVisible();
  expect(api.postFeedback).not.toHaveBeenCalled();
});

it("keeps an old report link from opening an unrelated active practice", () => {
  mount("some-other-practice");
  expect(screen.getByRole("link", {name: "查看练习历史"})).toHaveAttribute("href", "/progress");
  expect(api.postFeedback).not.toHaveBeenCalled();
});

it.each(["history", "live"])("uses the saved record identity to select a correction from a %s report", async source => {
  const createdAt = "2026-11-25T01:02:03.123456";
  const correction = { original: "latte", suggestion: "a latte", note: "加冠词", category: "articles", turn_index: 0 };
  const record = { ...feedback, id: 18, created_at: createdAt, scenario_id: "cafe", corrections: [correction] };
  api.setCorrectionPractice.mockResolvedValue([{ ...correction, marked: true }]);
  const messages = [{ role: "user" as const, content: "I'd like latte, please." }];
  if (source === "history") {
    api.getSession.mockResolvedValue({ ...record, messages });
    openSaved(`?${new URLSearchParams({ created_at: createdAt })}`);
  } else {
    useSession.getState().setSession("cafe", messages, `active-correction-${sequence}`);
    api.postSession.mockResolvedValue(record);
    mount();
  }
  await userEvent.click(await screen.findByRole("button", { name: "加入复练" }));
  expect(api.setCorrectionPractice).toHaveBeenCalledWith(18, createdAt, correction, true, expect.any(AbortSignal));
  if (source === "history") expect(api.getSession).toHaveBeenCalledWith(18, expect.any(AbortSignal), createdAt);
});
