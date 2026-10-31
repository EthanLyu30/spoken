import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getStats, getPractice, getSession, getSessions, getInsights, getProgressSessions, postSession } from "./api";
import { invalidateProgress } from "./progressCache";
import { clearToken, setToken } from "./authToken";
const response = (data: unknown) => ({ ok: true, json: async () => data });
beforeEach(() => { invalidateProgress(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); clearToken(); invalidateProgress(); });
it("shares concurrent statistics and fresh reads without sharing cancellation", async () => {
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise(r => { finish = r; }));
  vi.stubGlobal("fetch", fetcher);
  const a = new AbortController(), b = new AbortController();
  const first = getStats(a.signal), second = getStats(b.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  a.abort();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
  finish(response({ today_count: 3 }));
  await rejected;
  expect((await second).today_count).toBe(3);
  expect((await getStats()).today_count).toBe(3);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("abandons the last reader without letting its late completion remove a successor", async () => {
  const finishes: ((value: unknown) => void)[] = [];
  const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise(r => finishes.push(r)));
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  const old = getStats(controller.signal);
  const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  const current = getStats();
  finishes[0](response({ today_count: 99 }));
  await rejected;
  await Promise.resolve(); await Promise.resolve();
  const sibling = getStats();
  expect(fetcher).toHaveBeenCalledTimes(2);
  finishes[1](response({ today_count: 4 }));
  expect((await current).today_count).toBe(4);
  expect((await sibling).today_count).toBe(4);
});
it("expires reads at thirty seconds and separates practice parameters", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 1, 12));
  const fetcher = vi.fn().mockResolvedValue(response({ today_count: 1 }));
  vi.stubGlobal("fetch", fetcher);
  await getStats(); vi.advanceTimersByTime(29_999); await getStats();
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1); await getStats();
  await getPractice(undefined, 10); await getPractice(undefined, 20); await getPractice("interview", 20);
  expect(fetcher).toHaveBeenCalledTimes(5);
});
it("separates auth ABA, progress invalidation, and local midnight", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 1, 23, 59, 55));
  const fetcher = vi.fn().mockResolvedValue(response({ today_count: 1 })); vi.stubGlobal("fetch", fetcher);
  setToken("a"); await getStats(); setToken("b"); setToken("a"); await getStats();
  invalidateProgress(); await getStats();
  vi.setSystemTime(new Date(2026, 10, 2, 0, 0, 1)); await getStats();
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it("invalidates after a saved session and never caches private reports", async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ today_count: 1 })); vi.stubGlobal("fetch", fetcher);
  await getStats();
  await postSession({ scenario_id: "cafe", messages: [], overall: 80, summary: "", tip: "", scores: [] });
  await getStats(); await getSession(1); await getSession(1);
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it("bounds completed metadata to 32 entries instead of retaining every practice filter", async () => {
  const fetcher = vi.fn().mockResolvedValue(response([])); vi.stubGlobal("fetch", fetcher);
  for (let limit = 1; limit <= 33; limit++) await getPractice(undefined, limit);
  await getPractice(undefined, 33);
  expect(fetcher).toHaveBeenCalledTimes(33);
  await getPractice(undefined, 1);
  expect(fetcher).toHaveBeenCalledTimes(34);
});

it("separates devices and metadata URLs without storing failed reads", async () => {
  const client = await import("./clientId");
  const identity = vi.spyOn(client, "getClientId").mockReturnValue("device-a");
  const fetcher = vi.fn().mockResolvedValue(response([])); vi.stubGlobal("fetch", fetcher);
  await getSessions(); await getSessions(); await getInsights(); await getProgressSessions();
  expect(fetcher).toHaveBeenCalledTimes(3);
  identity.mockReturnValue("device-b"); await getSessions();
  fetcher.mockRejectedValueOnce(new Error("offline"));
  await expect(getStats()).rejects.toThrow("offline");
  await getStats();
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("rejects an in-flight read invalidated by a mutation even when transport ignores abort", async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(r => { finish = r; })));
  const pending = getStats();
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  invalidateProgress();
  finish(response({ today_count: 99 }));
  await rejected;
});

it("forces a new read and never restores the previous value after abandoning it", async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ today_count: 1 })); vi.stubGlobal("fetch", fetcher);
  await getStats();
  fetcher.mockReturnValueOnce(new Promise(() => {}));
  const controller = new AbortController();
  const forced = getStats(controller.signal, true);
  const rejected = expect(forced).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await rejected;
  fetcher.mockResolvedValue(response({ today_count: 2 }));
  expect((await getStats()).today_count).toBe(2);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("does not dispatch for an already cancelled reader", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController(); controller.abort();
  await expect(getStats(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).not.toHaveBeenCalled();
});
