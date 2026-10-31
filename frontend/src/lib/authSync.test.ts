import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ getMe: vi.fn(), getWords: vi.fn(), loginUser: vi.fn(), updateProfile: vi.fn() }));
vi.mock("./api", async (load) => ({ ...(await load<object>()), ...api }));
const account = (id: number) => ({ id, email: `test${id}@example.test`, display_name: "", avatar_url: "", created_at: "" });
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); localStorage.clear();
  vi.stubGlobal("BroadcastChannel", undefined);
  api.getWords.mockResolvedValue([]);
  api.getMe.mockResolvedValue(account(2));
});
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
async function setup() {
  const token = await import("./authToken");
  const { useAuth } = await import("../store/auth");
  const { useWords } = await import("../store/words");
  const { useSession } = await import("../store/session");
  const sync = await import("./authSync");
  stop = sync.initializeAuthSync();
  return { token, useAuth, useWords, useSession };
}
function storage(key: string | null = "spoken-token", newValue: string | null = null) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));
}
it("reconciles latest durable identity, clears caches synchronously and ignores duplicate/stale notifications", async () => {
  const { token, useAuth, useWords, useSession } = await setup();
  useWords.setState({ words: [{ id: 1 }] as never });
  useSession.getState().setSession("cafe", [{ role: "user", content: "hello" }], "old");
  localStorage.setItem("spoken-token", "latest-b");
  storage("spoken-token", "stale-a");
  expect(token.getToken()).toBe("latest-b");
  expect(token.getAuthGeneration()).toBe(1);
  expect(useWords.getState().words).toEqual([]);
  expect(useSession.getState().practiceId).toBeNull();
  expect(useAuth.getState().resolving).toBe(true);
  storage("spoken-token", null);
  expect(token.getAuthGeneration()).toBe(1);
  await flush();
  expect(useAuth.getState().user?.id).toBe(2);
  expect(api.getMe).toHaveBeenCalledTimes(1);
  localStorage.clear(); storage(null);
  expect(token.getToken()).toBeNull();
  expect(useAuth.getState().user).toBeNull();
  expect(useAuth.getState().resolving).toBe(false);
});
it("starts guests immediately without hydrating another account's optional metadata or words", async () => {
  localStorage.setItem("spoken-auth", JSON.stringify({ state: { user: account(1) }, version: 0 }));
  localStorage.setItem("spoken-words", JSON.stringify({ state: { words: [{ id: 1, text: "private" }] }, version: 0 }));
  const { useAuth, useWords } = await setup();
  expect(useAuth.getState().user).toBeNull(); expect(useAuth.getState().resolving).toBe(false);
  expect(useWords.getState().words).toEqual([]); expect(api.getMe).not.toHaveBeenCalled();
});
it("rejects stale refresh success, 401, and profile completion across A to B to A", async () => {
  const { token, useAuth } = await setup();
  token.setToken("a"); useAuth.setState({ user: account(1), resolving: false });
  let finish!: (v: ReturnType<typeof account>) => void;
  let fail!: (v: Error) => void;
  api.getMe.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const oldSuccess = useAuth.getState().refresh();
  api.getMe.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  const oldFailure = useAuth.getState().refresh();
  let profile!: (v: ReturnType<typeof account>) => void;
  api.updateProfile.mockReturnValueOnce(new Promise(resolve => { profile = resolve; }));
  const oldProfile = useAuth.getState().updateProfile({ display_name: "old" });
  token.setToken("b"); token.setToken("a"); useAuth.setState({ user: account(3), resolving: false });
  const { ApiError } = await import("./api");
  finish(account(1)); fail(new ApiError("expired", 401)); profile(account(1));
  await Promise.all([oldSuccess, oldFailure, oldProfile]);
  expect(useAuth.getState().user?.id).toBe(3); expect(token.getToken()).toBe("a");
  expect(token.getAuthGeneration()).toBe(3);
});
it("ignores unrelated persisted cache events and preserves same-account replacement epoch", async () => {
  const { token, useAuth } = await setup();
  token.setToken("a"); useAuth.setState({ user: account(1), resolving: false });
  localStorage.setItem("spoken-auth", JSON.stringify({ state: { user: account(9) }, version: 0 }));
  storage("spoken-auth");
  expect(useAuth.getState().user?.id).toBe(1);
  localStorage.setItem("spoken-token", "replacement-a"); storage();
  expect(token.getAuthGeneration()).toBe(2); expect(useAuth.getState().user).toBeNull();
});
it("preserves current-page RAM override when quota prevents durable login", async () => {
  const { token, useAuth } = await setup();
  const denied = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  api.loginUser.mockResolvedValue({ token: "ram", user: account(1) });
  await useAuth.getState().login("test@example.test", "password");
  denied.mockRestore(); localStorage.setItem("spoken-token", "other-tab"); storage();
  expect(token.getToken()).toBe("ram"); expect(useAuth.getState().user?.id).toBe(1);
});
it("uses BroadcastChannel only for invalidation and never rebroadcasts received changes", async () => {
  const sent: unknown[] = []; let receive!: (event: MessageEvent) => void;
  vi.stubGlobal("BroadcastChannel", class {
    set onmessage(value: (event: MessageEvent) => void) { receive = value; }
    postMessage(value: unknown) { sent.push(value); }
    close() {}
  });
  const { token } = await setup(); token.setToken("secret-a");
  expect(sent).toEqual([{ type: "identity-changed" }]);
  localStorage.setItem("spoken-token", "secret-b"); receive(new MessageEvent("message", { data: { type: "identity-changed", token: "untrusted" } }));
  expect(token.getToken()).toBe("secret-b"); expect(sent).toHaveLength(1);
});
it("continues storage synchronization when BroadcastChannel construction or sending throws", async () => {
  vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("denied"); } });
  const { token } = await setup();
  expect(() => token.setToken("a")).not.toThrow();
  localStorage.removeItem("spoken-token"); storage(); expect(token.getToken()).toBeNull();
});
it("offers retry after initial account resolution fails, while retaining the credential", async () => {
  localStorage.setItem("spoken-token", "a"); api.getMe.mockRejectedValueOnce(new TypeError("offline"));
  const { token, useAuth } = await setup(); await flush();
  expect(token.getToken()).toBe("a"); expect(useAuth.getState().resolutionError).toBe(true);
  expect(useAuth.getState().resolving).toBe(false);
  await useAuth.getState().refresh(); expect(useAuth.getState().user?.id).toBe(2);
});

it("bounds unresolved startup so a hung refresh exposes retry without discarding credentials", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("spoken-token", "hung-account");
    api.getMe.mockReturnValue(new Promise(() => {}));
    const { token, useAuth } = await setup();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(useAuth.getState().resolving).toBe(false);
    expect(useAuth.getState().resolutionError).toBe(true);
    expect(token.getToken()).toBe("hung-account");
  } finally { vi.useRealTimers(); }
});

it("does not restore a late vocabulary mutation after the canonical identity changes", async () => {
  const { token, useAuth, useWords } = await setup();
  token.setToken("a"); useAuth.setState({ user: account(1), resolving: false });
  let finish!: (value: import("./api").Word) => void;
  const mockApi = await import("./api");
  const post = vi.spyOn(mockApi, "postWord").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const remove = vi.spyOn(mockApi, "deleteWord").mockResolvedValue(undefined as never);
  useWords.getState().collect({ text: "private-word" });
  token.setToken("b"); finish({ id: 1, text: "private-word", meaning: "", example: "", scenario_id: "", kind: "word", mastered: false, created_at: "" }); await flush();
  expect(useWords.getState().words).toEqual([]); expect(remove).not.toHaveBeenCalled();
  post.mockRestore(); remove.mockRestore();
});

it("invalidates a guest session on storage.clear and on any observed changed guest ID before requests", async () => {
  localStorage.setItem("spoken-client-id", "guest-a");
  const { token, useSession } = await setup();
  const { getClientId } = await import("./clientId");
  expect(getClientId()).toBe("guest-a");
  useSession.getState().setSession("cafe", [{ role: "user", content: "old" }], "guest-session");
  localStorage.clear(); storage(null);
  expect(token.getAuthGeneration()).toBe(1);
  expect(useSession.getState().practiceId).toBeNull();
  const current = getClientId(); storage(null);
  expect(getClientId()).toBe(current); expect(token.getAuthGeneration()).toBe(1);
  localStorage.setItem("spoken-client-id", "guest-c");
  expect(getClientId()).toBe("guest-c"); expect(token.getAuthGeneration()).toBe(2);
});
it("reconciles missed guest changes on focus without invalidating signed-in accounts for device changes", async () => {
  localStorage.setItem("spoken-client-id", "guest-a");
  const { token } = await setup();
  localStorage.setItem("spoken-client-id", "guest-b"); window.dispatchEvent(new Event("focus"));
  expect(token.getAuthGeneration()).toBe(1);
  token.setToken("account");
  localStorage.setItem("spoken-client-id", "guest-c"); storage("spoken-client-id");
  expect(token.getAuthGeneration()).toBe(2);
  localStorage.clear(); storage(null);
  expect(token.getAuthGeneration()).toBe(3);
  expect(token.getToken()).toBeNull();
});

it("does not dispatch a captured guest session when save-key construction observes cleared storage", async () => {
  localStorage.setItem("spoken-client-id", "session-guest-a");
  const { token } = await setup();
  const { persistSessionOnce } = await import("./sessionSave");
  const apiModule = await import("./api");
  const post = vi.spyOn(apiModule, "postSession").mockResolvedValue({} as never);
  const generation = token.getAuthGeneration();
  localStorage.removeItem("spoken-client-id");
  await persistSessionOnce("cafe", [{ role: "user", content: "Old guest" }], { scenario_id: "cafe", overall: 80, summary: "", tip: "", scores: [], corrections: [], phrases: [] }, "old-guest-session", generation);
  expect(post).not.toHaveBeenCalled();
});
it("keeps auth mutations usable when BroadcastChannel postMessage throws", async () => {
  vi.stubGlobal("BroadcastChannel", class {
    onmessage = null;
    postMessage() { throw new Error("denied"); }
    close() {}
  });
  const { token } = await setup();
  expect(() => token.setToken("a")).not.toThrow();
  expect(() => token.clearToken()).not.toThrow();
});
