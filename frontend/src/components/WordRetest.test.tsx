import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { getWordRetest, getWords, rateWordRetest, reviewWord, startWordRetest, type Word, type WordRetestRound } from "../lib/api";
import { useWords } from "../store/words";
import { WordRetest } from "./WordRetest";

vi.mock("../lib/api", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/api")>(),
  getWordRetest: vi.fn(),
  getWords: vi.fn(),
  rateWordRetest: vi.fn(),
  reviewWord: vi.fn(),
  startWordRetest: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  useWords.getState().reset();
});

it("settles an offline review before the newer retest instead of replaying it over the retest later", async () => {
  const word: Word = { id: 87, text: "itinerary", meaning: "行程", example: "", scenario_id: "", kind: "word", mastered: true, created_at: "2026-11-25T11:45:10.123456" };
  let savedWord = word;
  let offline = true;
  let round: WordRetestRound = { id: "offline-review-round", words: 1, sentences: 0, familiar: 0, uncertain: 0,
    forgot: 0, skipped: 0, next_item: { position: 0, word } };
  const applied: string[] = [];
  useWords.setState({ words: [word] });
  vi.mocked(getWords).mockImplementation(async () => [savedWord]);
  vi.mocked(getWordRetest).mockImplementation(async () => ({ round, words: 1, sentences: 0, unadded_scene: 0 }));
  vi.mocked(reviewWord).mockImplementation(async (_id, _choice, _signal, key, incarnation) => {
    expect(incarnation).toBe(word.created_at);
    if (offline) throw new TypeError("offline before first delivery");
    expect(key).toBe("offline-first-delivery");
    applied.push("ordinary");
    return savedWord = { ...savedWord, familiarity: "familiar", box: 1 };
  });
  vi.mocked(rateWordRetest).mockImplementation(async () => {
    applied.push("retest");
    savedWord = { ...savedWord, familiarity: "forgot", mastered: false, box: 0 };
    return round = { ...round, forgot: 1, next_item: null };
  });
  await expect(useWords.getState().review(word, true, "offline-first-delivery")).rejects.toThrow("offline before first delivery");

  const user = userEvent.setup();
  render(<WordRetest onClose={vi.fn()} onFocus={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "继续重测" }));
  await user.click(screen.getByRole("button", { name: "查看参考" }));
  expect(screen.queryByRole("button", { name: "遗忘（忘了）" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "关闭参考" }));
  await user.type(screen.getByLabelText("输入英文"), "itinerary{Enter}");
  await user.click(screen.getByRole("button", { name: "遗忘（忘了）" }));
  const retry = await screen.findByRole("button", { name: "重试保存" });
  expect(applied).toEqual([]);

  offline = false;
  await user.click(retry);
  expect(await screen.findByRole("heading", { name: "重测完成" })).toBeVisible();
  await useWords.getState().refresh();
  expect(applied).toEqual(["ordinary", "retest"]);
  expect(useWords.getState().words[0]).toMatchObject({ familiarity: "forgot", mastered: false, box: 0 });
});

it("previews the scope, retries one rating, and resumes with the next saved item", async () => {
  const first = { id: 3, text: "quotation", meaning: "报价", example: "", scenario_id: "", kind: "word", mastered: true, created_at: "" };
  const second = { ...first, id: 4, text: "We can start today.", meaning: "我们可以今天开始。",
    review_translation: "我们可以今天开始。", kind: "sentence" };
  let round: WordRetestRound | null = null;
  const started = { id: "round-1", words: 1, sentences: 1, familiar: 0, uncertain: 0, forgot: 0, skipped: 0,
    next_item: { position: 0, word: first } };
  vi.mocked(getWordRetest).mockImplementation(async () => ({ round, words: 1, sentences: 1, unadded_scene: 1 }));
  vi.mocked(startWordRetest).mockImplementation(async () => round = started);
  vi.mocked(rateWordRetest).mockRejectedValueOnce(new Error("offline")).mockImplementation(async () => round = {
    ...started, forgot: 1, next_item: { position: 1, word: second },
  });
  const user = userEvent.setup();
  const component = <WordRetest onClose={vi.fn()} onFocus={vi.fn()} />;
  const view = render(component);
  expect(await screen.findByText("1 条单词与短语 · 1 句收藏")).toBeVisible();
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "开始重测" }));
  expect(await screen.findByText("已测 0 / 2 条")).toBeVisible();
  expect(screen.queryByText("quotation")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("输入英文"), "quotation{Enter}");
  await user.click(screen.getByRole("button", { name: "遗忘（忘了）" }));
  await user.click(await screen.findByRole("button", { name: "重试保存" }));
  expect(await screen.findByText(second.meaning)).toBeVisible();
  expect(vi.mocked(rateWordRetest).mock.calls).toEqual([["round-1", 0, false], ["round-1", 0, false]]);
  view.unmount();
  render(component);
  expect(await screen.findByText("已测 1 / 2 条")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "继续重测" }));
  expect(screen.getByText(second.meaning)).toBeVisible();
  expect(startWordRetest).toHaveBeenCalledExactlyOnceWith(false, undefined);
});

it("keeps completed counts separate from the next scope and updates totals with scene bookmarks", async () => {
  vi.mocked(getWordRetest).mockResolvedValue({ words: 2, sentences: 3, unadded_scene: 1, round: {
    id: "prior-round", words: 1, sentences: 0, familiar: 1, uncertain: 0, forgot: 0, skipped: 0, next_item: null,
  } });
  render(<WordRetest onClose={vi.fn()} onFocus={vi.fn()} />);
  expect(await screen.findByText("本轮 · 1 条单词与短语 · 0 句收藏")).toBeVisible();
  expect(screen.getByRole("heading", { name: "下一轮范围" })).toBeVisible();
  expect(screen.getByText("共 5 条")).toBeVisible();
  await userEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText("2 条单词与短语 · 4 句收藏")).toBeVisible();
  expect(screen.getByText("共 6 条")).toBeVisible();
});

it("keeps motion paused across questions and focuses the completed result", async () => {
  const first = { id: 71, text: "quotation", meaning: "报价", example: "", scenario_id: "", kind: "word",
    mastered: false, created_at: "2026-11-25T10:00:00.000171" };
  const second = { ...first, id: 72, text: "delivery", meaning: "交付", created_at: "2026-11-25T10:00:00.000172" };
  const firstQuestion = { id: "motion-round", words: 2, sentences: 0, familiar: 0, uncertain: 0, forgot: 0, skipped: 0,
    next_item: { position: 0, word: first } };
  const finalQuestion = { ...firstQuestion, familiar: 1, next_item: { position: 1, word: second } };
  const completed = { ...finalQuestion, familiar: 2, next_item: null };
  vi.mocked(getWordRetest).mockResolvedValueOnce({ words: 2, sentences: 0, unadded_scene: 0, round: firstQuestion })
    .mockResolvedValue({ words: 2, sentences: 0, unadded_scene: 0, round: completed });
  vi.mocked(rateWordRetest).mockResolvedValueOnce(finalQuestion).mockResolvedValueOnce(completed);
  const user = userEvent.setup();
  render(<WordRetest onClose={vi.fn()} onFocus={vi.fn()} />);

  await user.click(await screen.findByRole("button", { name: "继续重测" }));
  await user.click(screen.getByRole("button", { name: "暂停场景动效" }));
  expect(screen.getByRole("button", { name: "播放场景动效" })).toBeVisible();
  await user.type(screen.getByLabelText("输入英文"), "quotation{Enter}");
  await user.click(screen.getByRole("button", { name: "熟悉（记得）" }));
  expect(await screen.findByText(second.meaning)).toBeVisible();
  expect(screen.getByRole("button", { name: "播放场景动效" })).toBeVisible();
  await user.type(screen.getByLabelText("输入英文"), "delivery{Enter}");
  screen.getByRole("button", { name: "熟悉（记得）" }).focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("heading", { name: "重测完成" })).toHaveFocus();
});
