import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  getWords: vi.fn(),
  getMe: vi.fn(),
  postWord: vi.fn(),
  deleteWord: vi.fn(),
  patchWord: vi.fn(),
  reviewWord: vi.fn(),
}));
vi.mock("../lib/api", async (load) => ({ ...(await load<object>()), ...api }));
import { useWords } from "./words";
import { useAuth } from "./auth";
import type { Word } from "../lib/api";
const word = (id: number): Word => ({
  id,
  text: `word-${id}`,
  meaning: "",
  example: "",
  scenario_id: "",
  kind: "word",
  mastered: false,
  created_at: "",
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  vi.resetAllMocks();
  useWords.getState().reset();
  api.getWords.mockResolvedValue([]);
});

it("ignores an old owner's outstanding word fetch after reset", async () => {
  const old = deferred<Word[]>();
  api.getWords
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([word(2)]);
  const pending = useWords.getState().refresh();
  useWords.getState().reset();
  await useWords.getState().refresh();
  old.resolve([word(1)]);
  await pending;
  expect(useWords.getState().words).toEqual([word(2)]);
});

it("does not roll an old-owner failed removal into the new owner's word bag", async () => {
  const old = deferred<void>();
  api.deleteWord.mockReturnValue(old.promise);
  useWords.setState({ words: [word(1)] });
  useWords.getState().remove(1);
  useWords.getState().reset();
  useWords.setState({ words: [word(2)] });
  old.reject(new Error("offline"));
  await Promise.resolve();
  await Promise.resolve();
  expect(useWords.getState().words).toEqual([word(2)]);
});

it("does not delete a previously saved word under the new identity when a collect completes late", async () => {
  const old = deferred<Word>();
  api.postWord.mockReturnValue(old.promise);
  useWords.getState().collect({ text: "old-owner-word" });
  useWords.getState().reset();
  old.resolve(word(1));
  await Promise.resolve();
  await Promise.resolve();
  expect(api.deleteWord).not.toHaveBeenCalled();
  expect(useWords.getState().words).toEqual([]);
});

it("invalidating an expired account also replaces its cached words", async () => {
  useAuth.setState({
    user: {
      id: 1,
      email: "test@example.test",
      display_name: "",
      avatar_url: "",
      created_at: "",
    },
  });
  useWords.setState({ words: [word(1)] });
  api.getMe.mockRejectedValue(new Error("expired"));
  await useAuth.getState().refresh();
  await Promise.resolve();
  expect(useAuth.getState().user).toBeNull();
  expect(useWords.getState().words).toEqual([]);
});

it("does not restore an account if its refresh returns after logout", async () => {
  const account = {
    id: 1,
    email: "test@example.test",
    display_name: "",
    avatar_url: "",
    created_at: "",
  };
  const old = deferred<typeof account>();
  api.getMe.mockReturnValue(old.promise);
  useAuth.setState({ user: account });
  const pending = useAuth.getState().refresh();
  useAuth.getState().logout();
  old.resolve(account);
  await pending;
  expect(useAuth.getState().user).toBeNull();
});
