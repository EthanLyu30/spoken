import { StrictMode, type PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useProgressData } from "./useProgressData";
import { useProfileData } from "./useProfileData";
import { invalidateProgress } from "../lib/progressCache";

const summary = { id: 7, scenario_id: "cafe", overall: 80, created_at: "2026-11-01T12:00:00Z" };
const overview = {
  sessions: [summary],
  insights: { available: false, sessions: 1, overall_delta: 0, weakest: null, strongest: null, skills: [] },
  latest: { id: 7, scores: [{ key: "fluency", label_en: "Fluency", label_zh: "流利度", score: 80 }] },
};
const stats = { streak_days: 1, today_count: 1, today_goal: 3, level: 1, xp: 20, xp_to_next: 100, total_sessions: 1, total_practice: 0, words_count: 0 };
const response = (data: unknown) => ({ ok: true, json: async () => data });
beforeEach(() => invalidateProgress());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); invalidateProgress(); });

it("loads Progress with three parallel requests and no dependent report, sharing statistics with Home", async () => {
  let finishStats!: (value: unknown) => void;
  let finishPractice!: (value: unknown) => void;
  const fetcher = vi.fn((url: string) => {
    if (url === "/api/stats") return new Promise(r => { finishStats = r; });
    if (url.startsWith("/api/practice?")) return new Promise(r => { finishPractice = r; });
    if (url === "/api/progress/sessions") return Promise.resolve(response(overview));
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const home = renderHook(() => useProfileData(null, false));
  const progress = renderHook(() => useProgressData("integration"));
  await waitFor(() => expect(progress.result.current.sessions[0]?.id).toBe(7));
  expect(progress.result.current.latest?.scores[0].score).toBe(80);
  expect(progress.result.current.statsPending).toBe(true);
  expect(progress.result.current.practicePending).toBe(true);
  expect(fetcher.mock.calls.map(call => call[0]).sort()).toEqual([
    "/api/practice?limit=100", "/api/progress/sessions", "/api/stats",
  ]);
  home.unmount();
  await act(async () => { finishStats(response(stats)); finishPractice(response([])); });
  await waitFor(() => expect(progress.result.current.stats?.today_count).toBe(1));
  const returningHome = renderHook(() => useProfileData(null, false));
  await waitFor(() => expect(returningHome.result.current.stats?.today_count).toBe(1));
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("forces exactly one new request per section and retries an abandoned refresh", async () => {
  let refreshing = false;
  const fetcher = vi.fn((url: string) => refreshing ? new Promise(() => {}) : Promise.resolve(response(
    url === "/api/stats" ? stats : url === "/api/progress/sessions" ? overview : [],
  )));
  vi.stubGlobal("fetch", fetcher);
  const first = renderHook(() => useProgressData("reload"));
  await waitFor(() => expect(first.result.current.practicePending).toBe(false));
  refreshing = true;
  act(() => first.result.current.reload());
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(first.result.current.sessions[0]?.id).toBe(7);
  first.unmount();
  refreshing = false;
  const second = renderHook(() => useProgressData("reload"));
  await waitFor(() => expect(second.result.current.practicePending).toBe(false));
  expect(fetcher).toHaveBeenCalledTimes(9);
});

it("recovers from StrictMode effect abandonment without accepting the cancelled response", async () => {
  const fetcher = vi.fn((url: string) => Promise.resolve(response(
    url === "/api/stats" ? stats : url === "/api/progress/sessions" ? overview : [],
  )));
  vi.stubGlobal("fetch", fetcher);
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
  const hook = renderHook(() => useProgressData("strict"), { wrapper });
  await waitFor(() => expect(hook.result.current.practicePending).toBe(false));
  expect(hook.result.current.sessions[0]?.id).toBe(7);
  expect(hook.result.current.errors).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("forces fresh profile statistics even when shared metadata remains fresh", async () => {
  const fetcher = vi.fn().mockResolvedValue(response(stats));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useProfileData(null, false));
  await waitFor(() => expect(hook.result.current.stats?.today_count).toBe(1));
  fetcher.mockResolvedValue(response({ ...stats, today_count: 2 }));
  act(() => hook.result.current.reload());
  await waitFor(() => expect(hook.result.current.stats?.today_count).toBe(2));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not extend statistics freshness when a slower section updates the progress snapshot", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 10, 1, 12));
  let finishPractice!: (value: unknown) => void;
  const fetcher = vi.fn((url: string) => url.startsWith("/api/practice?")
    ? new Promise(r => { finishPractice = r; })
    : Promise.resolve(response(url === "/api/stats" ? stats : overview)));
  vi.stubGlobal("fetch", fetcher);
  const first = renderHook(() => useProgressData("bounded-snapshot"));
  await waitFor(() => expect(first.result.current.stats?.today_count).toBe(1));
  vi.setSystemTime(new Date(2026, 10, 1, 12, 0, 20));
  await act(async () => finishPractice(response([])));
  first.unmount();
  vi.setSystemTime(new Date(2026, 10, 1, 12, 0, 31));
  const second = renderHook(() => useProgressData("bounded-snapshot"));
  await waitFor(() => expect(fetcher.mock.calls.filter(call => call[0] === "/api/stats")).toHaveLength(2));
  second.unmount();
});
