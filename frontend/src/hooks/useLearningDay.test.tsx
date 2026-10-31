import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as day from "../lib/learningDay";
import { useLearningDay } from "./useLearningDay";
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("rolls over at midnight without refetching for unchanged focus events", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 30, 23, 59, 59));
  const {result} = renderHook(() => useLearningDay());
  const before = result.current;
  act(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(result.current).toBe(before);
  act(() => vi.advanceTimersByTime(1100));
  expect(result.current).not.toBe(before);
});
it("rechecks the timezone on visibility changes", () => {
  const current = vi.spyOn(day, "learningDay").mockReturnValue("Asia/Shanghai|2026-10-30");
  const {result} = renderHook(() => useLearningDay());
  current.mockReturnValue("UTC|2026-10-30");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current).toBe("UTC|2026-10-30");
});
