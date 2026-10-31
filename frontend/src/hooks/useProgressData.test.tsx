import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  getSessions: vi.fn(),
  getSession: vi.fn(),
  getStats: vi.fn(),
  getPractice: vi.fn(),
  getInsights: vi.fn(),
  getProgressSessions: vi.fn(),
}));
vi.mock("../lib/api", () => api);
import { useProgressData } from "./useProgressData";
import { invalidateProgress } from "../lib/progressCache";
const session = {
  id: 1,
  scenario_id: "cafe",
  overall: 80,
  created_at: "2026-10-28T10:00:00Z",
};
const overview = (sessions = [session]) => ({ sessions, insights: {available:false, sessions:1, overall_delta:0, weakest:null, strongest:null, skills:[]}, latest: {id:1,scores:[{key:"fluency",label_en:"Fluency",label_zh:"\u6d41\u5229\u5ea6",score:80}]} });
beforeEach(() => {
  vi.resetAllMocks();
  invalidateProgress();
  api.getProgressSessions.mockResolvedValue(overview());
  api.getSessions.mockResolvedValue([session]);
  api.getPractice.mockResolvedValue([]);
  api.getStats.mockResolvedValue({ total_sessions: 80 });
  api.getInsights.mockResolvedValue({ available: false, skills: [] });
  api.getSession.mockReturnValue(new Promise(() => {}));
});
it("shows history, insights and radar while statistics and practice remain pending", async () => {
  api.getStats.mockReturnValue(new Promise(() => {}));
  api.getPractice.mockReturnValue(new Promise(() => {}));
  const { result } = renderHook(() => useProgressData("device-a"));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.sessions).toEqual([session]);
  expect(result.current.latest?.scores[0].score).toBe(80);
  expect(result.current.insights?.available).toBe(false);
  expect(api.getSession).not.toHaveBeenCalled();
  expect(api.getInsights).not.toHaveBeenCalled();
});

it("resumes history requests when returning during a refresh with fast statistics",async()=>{
  const first=renderHook(()=>useProgressData("account-refresh"));
  await waitFor(()=>expect(first.result.current.practicePending).toBe(false));
  api.getProgressSessions.mockReturnValueOnce(new Promise(()=>{})).mockResolvedValueOnce(overview([{...session,id:3}]));
  api.getPractice.mockReturnValueOnce(new Promise(()=>{})).mockResolvedValueOnce([{id:3}]);
  api.getStats.mockResolvedValueOnce({total_sessions:90});
  act(()=>first.result.current.reload());
  await waitFor(()=>expect(first.result.current.stats?.total_sessions).toBe(90));
  first.unmount();
  const second=renderHook(()=>useProgressData("account-refresh"));
  await waitFor(()=>expect(api.getProgressSessions).toHaveBeenCalledTimes(3));
  await waitFor(()=>expect(second.result.current.practice[0]?.id).toBe(3));
  expect(second.result.current.sessions[0]?.id).toBe(3);
  expect(api.getInsights).not.toHaveBeenCalled();
});

it("retries every unfinished section when leaving before any refresh response arrives",async()=>{
  const first=renderHook(()=>useProgressData("account-no-refresh-response"));
  await waitFor(()=>expect(first.result.current.insightsPending).toBe(false));
  for(const method of [api.getProgressSessions,api.getPractice,api.getStats])
    method.mockReturnValueOnce(new Promise(()=>{}));
  act(()=>first.result.current.reload());
  await waitFor(()=>expect(first.result.current.sessionsPending).toBe(true));
  first.unmount();
  const second=renderHook(()=>useProgressData("account-no-refresh-response"));
  await waitFor(()=>expect(api.getProgressSessions).toHaveBeenCalledTimes(3));
  expect(api.getPractice).toHaveBeenCalledTimes(3);
  expect(api.getStats).toHaveBeenCalledTimes(3);
  expect(api.getInsights).not.toHaveBeenCalled();
  second.unmount();
});
it("does not fail history when optional statistics fail", async () => {
  api.getStats.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useProgressData("device-b"));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.sessions).toHaveLength(1);
  await waitFor(() => expect(result.current.errors).toContain("stats"));
});
it("retains readable session insights and radar when a manual refresh fails", async () => {
  const { result } = renderHook(() => useProgressData("retained-overview"));
  await waitFor(() => expect(result.current.latest?.id).toBe(1));
  api.getProgressSessions.mockRejectedValueOnce(new Error("offline"));
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.errors).toContain("sessions"));
  expect(result.current.sessions).toEqual([session]);
  expect(result.current.latest?.scores[0].score).toBe(80);
  expect(result.current.insights?.available).toBe(false);
  expect(result.current.insightsPending).toBe(false);
});
it("never displays or accepts the previous owner's late response", async () => {
  let resolve!: (value: ReturnType<typeof overview>) => void;
  api.getProgressSessions
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce(overview([]));
  const { result, rerender } = renderHook(
    ({ owner }) => useProgressData(owner),
    { initialProps: { owner: "account-a" } },
  );
  rerender({ owner: "account-b" });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(async () => resolve(overview()));
  expect(result.current.sessions).toEqual([]);
});
it("renders a fresh snapshot immediately and revalidates through metadata reads", async () => {
  const first = renderHook(() => useProgressData("account-c"));
  await waitFor(() => expect(first.result.current.status).toBe("ready"));
  first.unmount();
  const second = renderHook(() => useProgressData("account-c"));
  expect(second.result.current.sessions).toEqual([session]);
  expect(api.getProgressSessions).toHaveBeenCalledTimes(2);
  second.unmount();
  invalidateProgress();
  const third = renderHook(() => useProgressData("account-c"));
  await waitFor(() => expect(third.result.current.status).toBe("ready"));
  expect(api.getProgressSessions).toHaveBeenCalledTimes(3);
});

it("resumes unfinished sections on a quick return through metadata reads", async () => {
  api.getStats.mockReturnValueOnce(new Promise(() => {}));
  api.getPractice.mockReturnValueOnce(new Promise(() => {}));
  const first = renderHook(() => useProgressData("account-quick"));
  await waitFor(() => expect(first.result.current.status).toBe("ready"));
  first.unmount();
  const second = renderHook(() => useProgressData("account-quick"));
  await waitFor(() => expect(second.result.current.statsPending).toBe(false));
  expect(second.result.current.practicePending).toBe(false);
  expect(api.getProgressSessions).toHaveBeenCalledTimes(2);
  expect(api.getStats).toHaveBeenCalledTimes(2);
  expect(api.getPractice).toHaveBeenCalledTimes(2);
});

it("refreshes a mounted page when a practice finishes saving after navigation", async () => {
  const { result } = renderHook(() => useProgressData("account-mounted"));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  api.getPractice.mockResolvedValue([
    {
      id: 9,
      kind: "interview",
      score: 5,
      title: "Saved",
      created_at: "2026-10-28",
    },
  ]);
  act(() => invalidateProgress());
  await waitFor(() => expect(result.current.practice).toHaveLength(1));
  expect(api.getProgressSessions).toHaveBeenCalledTimes(2);
});

it("hides yesterday's stats on a day change while retaining history and rejects late stats", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 30, 12));
  const { result, unmount } = renderHook(() => useProgressData("day-change"));
  await waitFor(() => expect(result.current.stats?.total_sessions).toBe(80));
  let resolve!: (value: unknown) => void;
  api.getStats.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  act(() => { vi.setSystemTime(new Date(2026, 9, 31, 12)); window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(result.current.stats).toBeNull());
  expect(result.current.sessions).toEqual([session]);
  act(() => { vi.setSystemTime(new Date(2026, 10, 1, 12)); resolve({total_sessions: 999}); window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(result.current.stats?.total_sessions).toBe(80));
  unmount();
  vi.useRealTimers();
});

it("does not cache old stats as current when history finishes after midnight before a day recheck", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 30, 23, 59, 55));
  let finishPractice!: (value: unknown) => void;
  api.getPractice.mockReturnValueOnce(new Promise(resolve => { finishPractice = resolve; }));
  const { result, unmount } = renderHook(() => useProgressData("late-history"));
  await waitFor(() => expect(result.current.stats?.total_sessions).toBe(80));
  api.getStats.mockResolvedValueOnce({ total_sessions: 81 });
  api.getPractice.mockResolvedValueOnce([{ id: 9 }]);
  act(() => { vi.setSystemTime(new Date(2026, 9, 31, 0, 0, 1)); finishPractice([{ id: 9 }]); });
  await waitFor(() => expect(result.current.practice[0]?.id).toBe(9));
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(result.current.stats?.total_sessions).toBe(81));
  expect(api.getStats).toHaveBeenCalledTimes(2);
  expect(result.current.practice[0]?.id).toBe(9);
  unmount();
  vi.useRealTimers();
});
