import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { getWords, reviewWord, type Word } from "../lib/api";
import { clearToken } from "../lib/authToken";
import { rotateClientId } from "../lib/clientId";
import { useWords } from "../store/words";
import { WordReviewDeck } from "./WordReviewDeck";

vi.mock("../lib/api", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/api")>(), getWords: vi.fn(), reviewWord: vi.fn(),
}));
vi.mock("../lib/rewards", () => ({ playCafeChime: vi.fn(), useRewardEquipped: () => false }));

const word: Word = { id: 1, text: "completely new", meaning: "全新的", example: "", kind: "phrase",
  scenario_id: "", mastered: false, created_at: "2026-11-25T10:00:00.000001" };

beforeEach(() => {
  clearToken(); localStorage.clear(); rotateClientId(); vi.resetAllMocks();
  useWords.getState().reset();
  useWords.setState({ words: [word], fetchedOnce: true });
});

function openDeck(activity: "review" | "learn") {
  return render(<WordReviewDeck deck={[word]} activity={activity} mode="flip"
    review={useWords.getState().review} onDone={() => undefined} />);
}

it("moves keyboard focus to the original answer when the reveal button is replaced", async () => {
  const user = userEvent.setup();
  openDeck("learn");
  await user.click(screen.getByRole("button", { name: "试着回忆" }));
  screen.getByRole("button", { name: "显示原文" }).focus();
  await user.keyboard("{Enter}");
  expect(screen.getByText(word.text, { exact: true })).toHaveFocus();
});

it("clears the save error and finishes learning when background replay confirms the exact receipt", async () => {
  const saved = { ...word, box: 1, familiarity: "familiar" as const, last_reviewed: "2026-11-25T10:01:00" };
  vi.mocked(reviewWord).mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(saved);
  vi.mocked(getWords).mockResolvedValue([word]);
  const user = userEvent.setup();
  openDeck("learn");
  await user.click(screen.getByRole("button", { name: "试着回忆" }));
  await user.click(screen.getByRole("button", { name: "显示原文" }));
  await user.click(screen.getByRole("button", { name: "熟悉（记得）" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("熟悉标记尚未确认保存");

  await act(() => useWords.getState().refresh());

  expect(await screen.findByRole("heading", { name: "学习完成！" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const calls = vi.mocked(reviewWord).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1][3]).toBe(calls[0][3]);
});

it.each(["learn", "review"] as const)("does not schedule a replacement through an open %s card", async activity => {
  const user = userEvent.setup();
  openDeck(activity);
  if (activity === "learn") await user.click(screen.getByRole("button", { name: "试着回忆" }));
  const replacement = { ...word, created_at: "2026-11-25T10:00:00.000002" };
  vi.mocked(getWords).mockResolvedValue([replacement]);
  await act(() => useWords.getState().refresh());
  if (activity === "learn") await user.click(screen.getByRole("button", { name: "显示原文" }));
  await user.click(screen.getByRole("button", { name: /熟悉/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("原卡片的标记不能保存");
  expect(reviewWord).not.toHaveBeenCalled();
  expect(useWords.getState().words).toEqual([replacement]);
});

it("saves the restarted deck's newer selection even when the deck leaves during receipt recovery", async () => {
  let releaseOld!: (row: Word) => void;
  const oldSaved = { ...word, box: 1, familiarity: "familiar" as const };
  const newSaved = { ...word, box: 0, familiarity: "forgot" as const };
  vi.mocked(reviewWord).mockRejectedValueOnce(new Error("lost response"))
    .mockReturnValueOnce(new Promise(resolve => { releaseOld = resolve; }))
    .mockResolvedValueOnce(newSaved);
  const user = userEvent.setup();
  const original = openDeck("review");
  await user.click(screen.getByRole("button", { name: /熟悉/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("熟悉标记尚未确认保存");
  original.unmount();
  const restarted = openDeck("review");
  await user.click(screen.getByRole("button", { name: /遗忘/ }));
  expect(reviewWord).toHaveBeenCalledTimes(2);
  restarted.unmount();
  releaseOld(oldSaved);
  await waitFor(() => expect(useWords.getState().words[0].familiarity).toBe("forgot"));

  const calls = vi.mocked(reviewWord).mock.calls;
  expect(calls.map(call => [call[1], call[4]])).toEqual([
    [true, word.created_at], [true, word.created_at], [false, word.created_at],
  ]);
  expect(calls[0][3]).toBe(calls[1][3]);
  expect(calls[2][3]).not.toBe(calls[0][3]);
});
