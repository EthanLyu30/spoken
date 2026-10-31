import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  getSessions: vi.fn(),
  getStats: vi.fn(),
  getPractice: vi.fn(),
}));
vi.mock("../lib/api", () => api);
import { useProfileData } from "./useProfileData";
import { invalidateProgress } from "../lib/progressCache";
beforeEach(() => {
  vi.resetAllMocks();
  api.getSessions.mockResolvedValue([]);
  api.getStats.mockResolvedValue({ level: 3 });
  api.getPractice.mockResolvedValue([]);
});

it("clears displayed profile data immediately when the owner changes, including failed refetches", async () => {
  const { result, rerender } = renderHook(
    ({ owner }) => useProfileData(owner),
    { initialProps: { owner: 1 as number | null } },
  );
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.stats?.level).toBe(3);
  api.getStats.mockRejectedValue(new Error("offline"));
  act(() => rerender({ owner: null }));
  expect(result.current.stats).toBeNull();
  await waitFor(() => expect(result.current.errors).toContain("stats"));
  expect(result.current.sessions).toEqual([]);
  expect(result.current.practice).toEqual([]);
});

it("keeps successful history visible when statistics fail or remain slow",async()=>{
  api.getSessions.mockResolvedValue([{id:77}]);
  api.getStats.mockRejectedValue(new Error("stats offline"));
  const {result}=renderHook(()=>useProfileData(7));
  await waitFor(()=>expect(result.current.sessions).toHaveLength(1));
  expect(result.current.status).toBe("ready");
  expect(result.current.errors).toContain("stats");
});

it("refreshes profile history after a background save invalidates progress",async()=>{
  const {result}=renderHook(()=>useProfileData(8));
  await waitFor(()=>expect(result.current.status).toBe("ready"));
  api.getPractice.mockResolvedValue([{id:8}]);
  act(()=>invalidateProgress());
  await waitFor(()=>expect(result.current.practice).toHaveLength(1));
});

it("loads only the hero statistics for the voice settings tab",async()=>{
  const {result}=renderHook(()=>useProfileData(9,false));
  await waitFor(()=>expect(result.current.stats?.level).toBe(3));
  expect(api.getSessions).not.toHaveBeenCalled();
  expect(api.getPractice).not.toHaveBeenCalled();
});
