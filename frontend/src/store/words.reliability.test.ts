import { beforeEach, expect, it, vi } from "vitest";
import type { Word } from "../lib/api";
const api = vi.hoisted(() => ({ getWords: vi.fn(), postWord: vi.fn(), deleteWord: vi.fn(), patchWord: vi.fn(), reviewWord: vi.fn() }));
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
beforeEach(() => { vi.resetAllMocks(); useWords.getState().reset(); api.deleteWord.mockResolvedValue(undefined); });
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
  await expect(useWords.getState().review(1, true)).rejects.toThrow("response lost");
  await useWords.getState().review(1, true);
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

it("retains the failed review choice when a restarted deck selects the opposite answer", async()=>{
  api.reviewWord.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({...word,box:1});
  useWords.setState({words:[word]});await expect(useWords.getState().review(1,true)).rejects.toThrow("response lost");
  await expect(useWords.getState().review(1,false)).rejects.toMatchObject({remembered:true});
  await useWords.getState().review(1,true);
  expect(api.reviewWord.mock.calls.map(call=>[call[1],call[3]])).toEqual([[true,expect.any(String)],[true,api.reviewWord.mock.calls[0][3]]]);
  expect(useWords.getState().words[0].box).toBe(1);
});

it("retires a failed review after confirmed removal even if the server recycles the entire row identity", async () => {
  api.reviewWord.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({...word,box:0});
  api.postWord.mockResolvedValue(word);
  useWords.setState({words:[word]});
  await expect(useWords.getState().review(1,true)).rejects.toThrow("response lost");
  const oldKey=api.reviewWord.mock.calls[0][3];
  useWords.getState().remove(1);await flush();
  useWords.getState().collect({text:"hello"});await flush();
  await expect(useWords.getState().review(1,false)).resolves.toBeUndefined();
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
  await expect(useWords.getState().review(1,true)).rejects.toThrow("response lost");
  const oldKey=api.reviewWord.mock.calls[0][3];
  await useWords.getState().refresh();
  await expect(useWords.getState().review(1,false)).resolves.toBeUndefined();
  expect(api.reviewWord.mock.calls[1][3]).not.toBe(oldKey);
  expect(useWords.getState().words[0]).toMatchObject({...next,box:0});
});

it("keeps a failed review receipt through authoritative refresh of the same incarnation", async () => {
  api.reviewWord.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({...word,box:1});
  api.getWords.mockResolvedValue([word]);
  useWords.setState({words:[word]});
  await expect(useWords.getState().review(1,true)).rejects.toThrow("response lost");
  const key=api.reviewWord.mock.calls[0][3];
  await useWords.getState().refresh();await useWords.getState().review(1,true);
  expect(api.reviewWord.mock.calls[1][3]).toBe(key);
  expect(useWords.getState().words[0].box).toBe(1);
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
