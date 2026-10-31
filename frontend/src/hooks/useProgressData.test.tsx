import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  getSessions: vi.fn(),
  getSession: vi.fn(),
  getStats: vi.fn(),
  getPractice: vi.fn(),
  getInsights: vi.fn(),
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
beforeEach(() => {
  vi.resetAllMocks();
  invalidateProgress();
  api.getSessions.mockResolvedValue([session]);
  api.getPractice.mockResolvedValue([]);
  api.getStats.mockResolvedValue({ total_sessions: 80 });
  api.getInsights.mockResolvedValue({ available: false, skills: [] });
  api.getSession.mockReturnValue(new Promise(() => {}));
});
it("shows history while the optional latest report is still pending", async () => {
  const { result } = renderHook(() => useProgressData("device-a"));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.sessions).toEqual([session]);
  expect(result.current.latest).toBeNull();
});

it("resumes history requests when returning during a refresh with fast statistics",async()=>{
  const first=renderHook(()=>useProgressData("account-refresh"));
  await waitFor(()=>expect(first.result.current.practicePending).toBe(false));
  api.getSessions.mockReturnValueOnce(new Promise(()=>{})).mockResolvedValueOnce([{...session,id:3}]);
  api.getPractice.mockReturnValueOnce(new Promise(()=>{})).mockResolvedValueOnce([{id:3}]);
  api.getStats.mockResolvedValueOnce({total_sessions:90});
  api.getInsights.mockReturnValueOnce(new Promise(()=>{}));
  act(()=>first.result.current.reload());
  await waitFor(()=>expect(first.result.current.stats?.total_sessions).toBe(90));
  first.unmount();
  const second=renderHook(()=>useProgressData("account-refresh"));
  await waitFor(()=>expect(api.getSessions).toHaveBeenCalledTimes(3));
  await waitFor(()=>expect(second.result.current.practice[0]?.id).toBe(3));
  expect(second.result.current.sessions[0]?.id).toBe(3);
  expect(api.getInsights).toHaveBeenCalledTimes(3);
});
it("does not fail history when optional statistics fail", async () => {
  api.getStats.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useProgressData("device-b"));
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.sessions).toHaveLength(1);
  await waitFor(() => expect(result.current.errors).toContain("stats"));
});
it("never displays or accepts the previous owner's late response", async () => {
  let resolve!: (value: (typeof session)[]) => void;
  api.getSessions
    .mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    )
    .mockResolvedValueOnce([]);
  const { result, rerender } = renderHook(
    ({ owner }) => useProgressData(owner),
    { initialProps: { owner: "account-a" } },
  );
  rerender({ owner: "account-b" });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  await act(async () => resolve([session]));
  expect(result.current.sessions).toEqual([]);
});
it("reuses a fresh identity cache and invalidates it after a saved practice", async () => {
  const first = renderHook(() => useProgressData("account-c"));
  await waitFor(() => expect(first.result.current.status).toBe("ready"));
  first.unmount();
  const second = renderHook(() => useProgressData("account-c"));
  expect(second.result.current.sessions).toEqual([session]);
  expect(api.getSessions).toHaveBeenCalledTimes(1);
  second.unmount();
  invalidateProgress();
  const third = renderHook(() => useProgressData("account-c"));
  await waitFor(() => expect(third.result.current.status).toBe("ready"));
  expect(api.getSessions).toHaveBeenCalledTimes(2);
});

it("resumes unfinished cached sections on a quick return without refetching history", async () => {
  api.getStats.mockReturnValueOnce(new Promise(() => {}));
  api.getPractice.mockReturnValueOnce(new Promise(() => {}));
  const first = renderHook(() => useProgressData("account-quick"));
  await waitFor(() => expect(first.result.current.status).toBe("ready"));
  first.unmount();
  const second = renderHook(() => useProgressData("account-quick"));
  await waitFor(() => expect(second.result.current.statsPending).toBe(false));
  expect(second.result.current.practicePending).toBe(false);
  expect(api.getSessions).toHaveBeenCalledTimes(1);
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
  expect(api.getSessions).toHaveBeenCalledTimes(2);
});
