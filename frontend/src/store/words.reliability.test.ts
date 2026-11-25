import { beforeEach, expect, it, vi } from "vitest";
import type { Word, WordRetestRound } from "../lib/api";
import { clearToken, setToken } from "../lib/authToken";
import { rotateClientId } from "../lib/clientId";
const api = vi.hoisted(() => ({ getWords: vi.fn(), postWord: vi.fn(), deleteWord: vi.fn(), patchWord: vi.fn(), reviewWord: vi.fn(), rateWordRetest: vi.fn() }));
vi.mock("../lib/api", () => api);
import { useWords } from "./words";
const word: Word = { id: 1, text: "hello", meaning: "你好", example: "", scenario_id: "", kind: "word", mastered: false, created_at: "" };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0;i < 12;i++)
    await Promise.resolve();
};
beforeEach(() => { clearToken(); localStorage.clear(); rotateClientId(); vi.resetAllMocks(); useWords.getState().reset(); api.deleteWord.mockResolvedValue(undefined); });

it("cannot rate the replacement of a mounted card with a recycled id", async () => {
  const shown = { ...word, created_at: "2026-11-25T11:45:10.123456" };
  const current = { ...shown, created_at: "2026-11-25T11:45:10.123457" };
  useWords.setState({ words: [current] });
  await expect(useWords.getState().review(shown, true, "stale-card")).rejects.toMatchObject({ code: "word_changed" });
  expect(api.reviewWord).not.toHaveBeenCalled();
  expect(useWords.getState().words).toEqual([current]);
});

it("retains the newer rating through reload while recovering the older receipt", async () => {
  const shown = { ...word, created_at: "2026-11-25T11:45:10.123456" };
  const recovering = deferred<Word>();
  const original = { ...shown, familiarity: "familiar" as const, box: 1 };
  const latest = { ...shown, familiarity: "forgot" as const, box: 0 };
  api.getWords.mockResolvedValue([original]);
  api.reviewWord.mockRejectedValueOnce(new Error("first response lost"))
    .mockReturnValueOnce(recovering.promise).mockResolvedValueOnce(original).mockResolvedValueOnce(latest);
  useWords.setState({ words: [shown] });
  await expect(useWords.getState().review(shown, true, "original-rating")).rejects.toThrow("first response lost");
  const departed = useWords.getState().review(shown, false, "new-rating").catch(() => undefined);
  await flush();
  expect(api.reviewWord.mock.calls.map(call => call[3])).toEqual(["original-rating", "original-rating"]);
  useWords.getState().reset();
  vi.resetModules();
  const { useWords: reloadedWords } = await import("./words");
  await reloadedWords.getState().refresh();
  await vi.waitFor(() => expect(reloadedWords.getState().words[0].familiarity).toBe("forgot"));
  expect(api.reviewWord.mock.calls.map(call => [call[1], call[3], call[4]])).toEqual([
    [true, "original-rating", shown.created_at], [true, "original-rating", shown.created_at],
    [true, "original-rating", shown.created_at], [false, "new-rating", shown.created_at],
  ]);
  recovering.resolve(original);
  await departed;
  expect(reloadedWords.getState().words[0].familiarity).toBe("forgot");
});

it("pauses both receipts on an account change without replaying them under the new owner", async () => {
  const previousToken = `test.${btoa(JSON.stringify({ sub: "1", ver: "first" }))}.signature`;
  const nextToken = `test.${btoa(JSON.stringify({ sub: "2", ver: "second" }))}.signature`;
  const shown = { ...word, created_at: "2026-11-25T11:45:10.123456" };
  const recovering = deferred<Word>();
  const original = { ...shown, familiarity: "familiar" as const, box: 1 };
  const latest = { ...shown, familiarity: "forgot" as const, box: 0 };
  api.reviewWord.mockRejectedValueOnce(new Error("response lost")).mockReturnValueOnce(recovering.promise)
    .mockResolvedValueOnce(original).mockResolvedValueOnce(latest);
  setToken(previousToken);
  useWords.setState({ words: [shown] });
  await expect(useWords.getState().review(shown, true, "account-one-original")).rejects.toThrow("response lost");
  const departed = useWords.getState().review(shown, false, "account-one-new").catch(() => undefined);
  await flush();
  expect(api.reviewWord).toHaveBeenCalledTimes(2);
  setToken(nextToken);
  useWords.getState().reset();
  api.getWords.mockResolvedValue([shown]);
  await useWords.getState().refresh();
  recovering.resolve(original);
  await departed;
  expect(api.reviewWord).toHaveBeenCalledTimes(2);
  expect(useWords.getState().words).toEqual([shown]);

  setToken(previousToken);
  useWords.getState().reset();
  await useWords.getState().refresh();
  await vi.waitFor(() => expect(useWords.getState().words[0].familiarity).toBe("forgot"));
  expect(api.reviewWord.mock.calls.map(call => call[3])).toEqual([
    "account-one-original", "account-one-original", "account-one-original", "account-one-new",
  ]);
});
it("keeps a committed collection when refresh arrives before its POST response", async () => {
  const pending = deferred<Word>();
  api.postWord.mockReturnValue(pending.promise);
  api.getWords.mockResolvedValue([word]);
  useWords.getState().collect({ text: "hello" });
  await useWords.getState().refresh();
  pending.resolve(word);
  await flush();
  expect(useWords.getState().words).toEqual([word]);
  expect(api.deleteWord).not.toHaveBeenCalled();
});
it("keeps the last collect intent after remove and re-add during creation", async () => {
  const pending = deferred<Word>();
  api.postWord.mockReturnValue(pending.promise);
  useWords.getState().collect({ text: "hello" });
  useWords.getState().remove(useWords.getState().words[0].id);
  useWords.getState().collect({ text: "hello" });
  pending.resolve(word);
  await flush();
  expect(useWords.getState().words).toEqual([word]);
  expect(api.deleteWord).not.toHaveBeenCalled();
  expect(api.postWord).toHaveBeenCalledTimes(1);
});
it("does not resurrect an explicitly removed collection from a stale refresh", async () => {
  const pending = deferred<Word[]>();
  api.getWords.mockReturnValue(pending.promise);
  useWords.setState({ words: [word] });
  const refresh = useWords.getState().refresh();
  useWords.getState().remove(1);
  await flush();
  pending.resolve([word]);
  await refresh;
  expect(useWords.getState().words).toEqual([]);
});
it("serializes mastery writes so the server and UI keep the latest toggle", async () => {
  const first = deferred<Word>();
  let server = false;
  api.patchWord.mockImplementation(async (_id: number, value: boolean) => {
    if (value) {
      await first.promise;
    }
    server = value;
    return { ...word, mastered: value };
  });
  useWords.setState({ words: [word] });
  useWords.getState().toggleMaster(1);
  useWords.getState().toggleMaster(1);
  await flush();
  expect(api.patchWord).toHaveBeenCalledTimes(1);
  first.resolve({ ...word, mastered: true });
  await flush();
  expect(server).toBe(false);
  expect(useWords.getState().words[0].mastered).toBe(false);
});
it("keeps optimistic mastery through a refresh and an earlier write failure", async () => {
  const first = deferred<Word>(), second = deferred<Word>();
  api.patchWord.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  api.getWords.mockResolvedValue([word]);
  useWords.setState({ words: [word] });
  useWords.getState().toggleMaster(1);
  await useWords.getState().refresh();
  expect(useWords.getState().words[0].mastered).toBe(true);
  useWords.getState().toggleMaster(1);
  first.reject(new Error("offline"));
  await flush();
  expect(useWords.getState().words[0].mastered).toBe(false);
  second.resolve(word);
  await flush();
  expect(useWords.getState().words[0].mastered).toBe(false);
});
it("returns failed reviews and reuses the same receipt when the response was lost", async () => {
  api.reviewWord.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ...word, box: 1 });
  useWords.setState({ words: [word] });
  await expect(useWords.getState().review(word, true, "first-choice")).rejects.toThrow("response lost");
  await useWords.getState().review(word, true, "first-choice");
  const key = api.reviewWord.mock.calls[0][3];
  expect(key).toEqual(expect.any(String));
  expect(key.length).toBeLessThanOrEqual(80);
  expect(api.reviewWord.mock.calls[1][3]).toBe(key);
  expect(useWords.getState().words[0].box).toBe(1);
});
it("does not dispatch queued mastery under a new owner", async () => {
  const first = deferred<Word>();
  api.patchWord.mockReturnValue(first.promise);
  useWords.setState({ words: [word] });
  useWords.getState().toggleMaster(1);
  useWords.getState().toggleMaster(1);
  await flush();
  useWords.getState().reset();
  useWords.setState({ words: [{ ...word, text: "new owner" }] });
  first.resolve({ ...word, mastered: true });
  await flush();
  expect(api.patchWord).toHaveBeenCalledTimes(1);
  expect(useWords.getState().words[0].text).toBe("new owner");
});

it("after confirming the older receipt, retries only the newer choice that lost its response", async () => {
  api.reviewWord.mockRejectedValueOnce(new Error("old response lost")).mockResolvedValueOnce({ ...word, box: 1 })
    .mockRejectedValueOnce(new Error("new response lost")).mockResolvedValueOnce({ ...word, box: 0 });
  useWords.setState({ words: [word] });
  await expect(useWords.getState().review(word, true, "old-choice")).rejects.toThrow("old response lost");
  await expect(useWords.getState().review(word, false, "new-choice")).rejects.toThrow("new response lost");
  await useWords.getState().review(word, false, "new-choice");
  expect(api.reviewWord.mock.calls.map(call => [call[1], call[3]])).toEqual([
    [true, "old-choice"], [true, "old-choice"], [false, "new-choice"], [false, "new-choice"],
  ]);
  expect(useWords.getState().words[0].box).toBe(0);
});

it("keeps a newly selected identical rating distinct from a retry of the older receipt", async () => {
  api.reviewWord.mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ ...word, box: 1 })
    .mockResolvedValueOnce({ ...word, box: 2 });
  useWords.setState({ words: [word] });
  await expect(useWords.getState().review(word, true, "first-card")).rejects.toThrow("lost response");
  await useWords.getState().review(word, true, "second-card");
  expect(api.reviewWord.mock.calls.map(call => call[3])).toEqual(["first-card", "first-card", "second-card"]);
  expect(useWords.getState().words[0].box).toBe(2);
});

it("retires a failed review after confirmed removal even if the server recycles the entire row identity", async () => {
  api.reviewWord.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({...word,box:0});
  api.postWord.mockResolvedValue(word);
  useWords.setState({words:[word]});
  await expect(useWords.getState().review(word,true,"deleted-choice")).rejects.toThrow("response lost");
  const oldKey=api.reviewWord.mock.calls[0][3];
  useWords.getState().remove(1);await flush();
  useWords.getState().collect({text:"hello"});await flush();
  await expect(useWords.getState().review(word,false,"recollected-choice")).resolves.toBeUndefined();
  expect(api.reviewWord.mock.calls[1][3]).not.toBe(oldKey);
  expect(useWords.getState().words[0].box).toBe(0);
});

it.each([
  {created_at:"2026-11-02T00:00:00Z"},
  {text:"new word"},
])("starts a fresh review receipt when authoritative refresh replaces recycled id: %j", async replacement => {
  const next={...word,...replacement};
  api.reviewWord.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({...next,box:0});
  api.getWords.mockResolvedValue([next]);
  useWords.setState({words:[word]});
  await expect(useWords.getState().review(word,true,"recycled-choice")).rejects.toThrow("response lost");
  const oldKey=api.reviewWord.mock.calls[0][3];
  await useWords.getState().refresh();
  await expect(useWords.getState().review(word,false,"stale-choice")).rejects.toMatchObject({ code: "word_changed" });
  await expect(useWords.getState().review(next,false,"replacement-choice")).resolves.toBeUndefined();
  expect(api.reviewWord.mock.calls[1][3]).not.toBe(oldKey);
  expect(useWords.getState().words[0]).toMatchObject({...next,box:0});
});

it("keeps a failed review receipt through authoritative refresh of the same incarnation", async () => {
  api.reviewWord.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({...word,box:1});
  api.getWords.mockResolvedValue([word]);
  useWords.setState({words:[word]});
  await expect(useWords.getState().review(word,true,"recover-choice")).rejects.toThrow("response lost");
  const key=api.reviewWord.mock.calls[0][3];
  await useWords.getState().refresh();
  await vi.waitFor(() => expect(useWords.getState().words[0].box).toBe(1));
  expect(api.reviewWord.mock.calls[1][3]).toBe(key);
  expect(useWords.getState().words[0].box).toBe(1);
});

it("reports a background-confirmed receipt and does not send it again on manual retry", async () => {
  api.reviewWord.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...word, box: 1 });
  api.getWords.mockResolvedValue([word]);
  useWords.setState({ words: [word] });
  await expect(useWords.getState().review(word, true, "background-confirmed")).rejects.toThrow("offline");
  await useWords.getState().refresh();
  await vi.waitFor(() => expect(useWords.getState().words[0].box).toBe(1));
  await useWords.getState().review(word, true, "background-confirmed");
  expect(api.reviewWord).toHaveBeenCalledTimes(2);
  expect(useWords.getState().confirmedReviewReceipts.has("background-confirmed")).toBe(true);
  useWords.getState().reset();
  expect(useWords.getState().confirmedReviewReceipts.has("background-confirmed")).toBe(false);
});

it("keeps a newer ordinary rating behind the retest while the old review is recovered", async () => {
  const recovered = deferred<Word>();
  const applied: string[] = [];
  api.reviewWord.mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(async () => { const row = await recovered.promise; applied.push("older review"); return row; })
    .mockImplementationOnce(async () => { applied.push("newer review"); return { ...word, familiarity: "uncertain" }; });
  api.rateWordRetest.mockImplementation(async (): Promise<WordRetestRound> => {
    applied.push("retest");
    return { id: "round", words: 1, sentences: 0, familiar: 0, uncertain: 0, forgot: 1, skipped: 0, next_item: null };
  });
  useWords.setState({ words: [word] });
  await expect(useWords.getState().review(word, true, "old-before-retest")).rejects.toThrow("offline");
  const retest = useWords.getState().rateRetest(word, "round", 0, false);
  const newer = useWords.getState().review(word, "uncertain", "new-after-retest");
  await flush();
  expect(applied).toEqual([]);
  recovered.resolve({ ...word, familiarity: "familiar" });
  await Promise.all([retest, newer]);
  expect(applied).toEqual(["older review", "retest", "newer review"]);
  expect(useWords.getState().words[0].familiarity).toBe("uncertain");
});

it("does not send a retest after the owner switches while an old rating is in flight", async () => {
  const recovered = deferred<Word>();
  api.reviewWord.mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(recovered.promise);
  useWords.setState({ words: [word] });
  await expect(useWords.getState().review(word, true, "pre-switch-review")).rejects.toThrow("offline");
  const retest = useWords.getState().rateRetest(word, "old-owner-round", 0, false);
  const rejected = expect(retest).rejects.toMatchObject({ name: "AbortError" });
  expect(api.reviewWord).toHaveBeenCalledTimes(2);
  setToken(`test.${btoa(JSON.stringify({ sub: "8", ver: "second" }))}.signature`);
  useWords.getState().reset();
  useWords.setState({ words: [word] });
  recovered.resolve({ ...word, familiarity: "familiar" });
  await rejected;
  expect(api.rateWordRetest).not.toHaveBeenCalled();
  expect(useWords.getState().words).toEqual([word]);
});

it("rebases mastery rollback on the latest idle authoritative refresh", async () => {
  api.patchWord.mockResolvedValueOnce({...word,mastered:true}).mockRejectedValueOnce(new Error("offline"));
  api.getWords.mockResolvedValue([word]);
  useWords.setState({words:[word]});
  useWords.getState().toggleMaster(1);await flush();
  expect(useWords.getState().words[0].mastered).toBe(true);
  await useWords.getState().refresh();
  useWords.getState().toggleMaster(1);await flush();
  expect(useWords.getState().words[0].mastered).toBe(false);
});

it("does not reuse old mastery confirmation after confirmed removal and recycled-id re-add", async () => {
  api.patchWord.mockResolvedValueOnce({...word,mastered:true}).mockRejectedValueOnce(new Error("offline"));
  api.postWord.mockResolvedValue(word);
  useWords.setState({words:[word]});
  useWords.getState().toggleMaster(1);await flush();
  useWords.getState().remove(1);await flush();
  useWords.getState().collect({text:"hello"});await flush();
  useWords.getState().toggleMaster(1);await flush();
  expect(useWords.getState().words[0].mastered).toBe(false);
});
