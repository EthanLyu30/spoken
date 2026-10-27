import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  getSessions: vi.fn(),
  getStats: vi.fn(),
  getPractice: vi.fn(),
}));
vi.mock("../lib/api", () => api);
import { useProfileData } from "./useProfileData";
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
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.sessions).toEqual([]);
  expect(result.current.practice).toEqual([]);
});
