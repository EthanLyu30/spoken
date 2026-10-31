import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  getWords: vi.fn(),
  getMe: vi.fn(),
  postWord: vi.fn(),
  deleteWord: vi.fn(),
  patchWord: vi.fn(),
  reviewWord: vi.fn(),
  loginUser: vi.fn(),
}));
vi.mock("../lib/api", async (load) => ({ ...(await load<object>()), ...api }));
import { useWords } from "./words";
import { useAuth } from "./auth";
import { setToken, getToken } from "../lib/authToken";
import { ApiError } from "../lib/api";
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
  api.getMe.mockRejectedValue(new ApiError("expired",401));
  await useAuth.getState().refresh();
  await Promise.resolve();
  expect(useAuth.getState().user).toBeNull();
  expect(useWords.getState().words).toEqual([]);
});

it("does not log out a valid account or clear its words after a transient refresh failure",async()=>{
  const account={id:7,email:"test@example.test",display_name:"",avatar_url:"",created_at:""};
  useAuth.setState({user:account});setToken("valid-session");useWords.setState({words:[word(7)]});
  api.getMe.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await useAuth.getState().refresh();
  expect(useAuth.getState().user).toEqual(account);
  expect(getToken()).toBe("valid-session");expect(useWords.getState().words).toEqual([word(7)]);
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

it("can log in and out consistently when browser storage denies all writes",async()=>{
  const account={id:9,email:"test@example.test",display_name:"",avatar_url:"",created_at:""};
  api.loginUser.mockResolvedValueOnce({token:"restricted-storage-token",user:account});
  const denied=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("quota");});
  try {
    await expect(useAuth.getState().login("test@example.test","test-password")).resolves.toBeUndefined();
    expect(useAuth.getState().user?.id).toBe(9);expect(getToken()).toBe("restricted-storage-token");
    expect(()=>useAuth.getState().logout()).not.toThrow();
    expect(getToken()).toBeNull();expect(useAuth.getState().user).toBeNull();
  } finally {denied.mockRestore();}
});
